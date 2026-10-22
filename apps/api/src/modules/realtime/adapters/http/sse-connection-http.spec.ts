import { once } from 'node:events';
import { createServer, get } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { SseConnection } from './sse-connection.js';

async function serverFixture(lifetime = 20000) {
  const connections = new Map<
    string,
    { connection: SseConnection; released: ReturnType<typeof vi.fn> }
  >();
  const responses: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.flushHeaders();
    const released = vi.fn();
    const connection = new SseConnection(response, () => true, released);
    connections.set(request.url!, { connection, released });
    connection.start(Date.now() + lifetime);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  return {
    connections,
    open: (path: string) =>
      new Promise<IncomingMessage>((resolve, reject) => {
        const call = get(
          `http://127.0.0.1:${port}${path}`,
          { headers: { Connection: 'close' } },
          (response) => {
            response.on('error', () => {});
            responses.push(response);
            resolve(response);
          },
        );
        call.on('error', reject);
      }),
    close: async () => {
      for (const { connection } of connections.values()) connection.close();
      for (const response of responses) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

it('ServerResponse real aísla cola saturada y mantiene otro consumidor TCP', async () => {
  const f = await serverFixture();
  try {
    const slow = await f.open('/slow');
    slow.pause();
    const healthy = await f.open('/healthy');
    const a = f.connections.get('/slow')!,
      b = f.connections.get('/healthy')!;
    // La primera escritura supera el highWaterMark real de Node. Sin ceder al
    // loop, las siguientes quedan en cola y el mensaje 1001 debe cerrar solo a.
    expect(a.connection.enqueue('x'.repeat(512 * 1024))).toBe(true);
    for (let index = 0; index < 999; index++) expect(a.connection.enqueue('x')).toBe(true);
    expect(a.connection.enqueue('overflow')).toBe(false);
    expect(a.released).toHaveBeenCalledOnce();
    const received = once(healthy, 'data');
    expect(b.connection.enqueue('data:still-live\n\n')).toBe(true);
    expect(String((await received)[0])).toBe('data:still-live\n\n');
    expect(b.connection.isClosed).toBe(false);
    expect(b.released).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
}, 5000);

it('el temporizador absoluto cierra un stream HTTP ocioso sin esperar nuevos mensajes', async () => {
  const f = await serverFixture(250);
  try {
    const response = await f.open('/expiry');
    // El cierre intencional de ServerResponse emite aborted/error en el cliente
    // antes de close; se observa el cierre sin exigir un fin HTTP normal.
    await new Promise<void>((resolve) => response.once('close', () => resolve()));
    const value = f.connections.get('/expiry')!;
    expect(value.connection.isClosed).toBe(true);
    expect(value.released).toHaveBeenCalledOnce();
  } finally {
    await f.close();
  }
}, 5000);
