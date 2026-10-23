import { createServer, request } from 'node:http';
import { randomUUID } from 'node:crypto';

// Sirve el mismo origen y conserva las cabeceras de NGINX, incluida su CSP.
// El upstream es el puerto efímero del web propio, nunca la API directamente.
// El corte destruye sockets de un único cliente, sin fabricar mensajes.
export async function streamCut({ upstreamPort = process.env.NEXO_SYSTEM_WEB_UPSTREAM_PORT } = {}) {
  if (
    !/^[1-9]\d{3,4}$/.test(upstreamPort ?? '') ||
    Number(upstreamPort) < 1024 ||
    Number(upstreamPort) > 65535 ||
    Number(upstreamPort) === 8081
  )
    throw new Error('El corte SSE requiere el puerto de loopback del web propio.');
  const selectedPath = '/api/stream?nexo-cut=' + randomUUID();
  let blocked = false;
  const connections = new Set();
  const allConnections = new Set();
  const statuses = [];
  const server = createServer((incoming, outgoing) => {
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
      outgoing.writeHead(400).end();
      return;
    }
    const selected = incoming.method === 'GET' && incoming.url === selectedPath;
    if (selected && blocked) {
      outgoing.writeHead(503, { 'Retry-After': '2' }).end();
      return;
    }
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: Number(upstreamPort),
        method: incoming.method,
        path: selected ? '/api/stream' : incoming.url,
        headers: { ...incoming.headers, host: 'localhost:8081' },
      },
      (response) => {
        if (selected) statuses.push(response.statusCode);
        outgoing.writeHead(response.statusCode, response.headers);
        response.on('error', () => outgoing.destroy());
        response.pipe(outgoing);
      },
    );
    const pair = { upstream, outgoing };
    allConnections.add(pair);
    if (selected) connections.add(pair);
    upstream.on('error', () => outgoing.destroy());
    outgoing.on('close', () => {
      upstream.destroy();
      connections.delete(pair);
      allConnections.delete(pair);
    });
    incoming.on('error', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8081, '127.0.0.1', resolve);
  });
  const disconnect = () => {
    blocked = true;
    for (const { upstream, outgoing } of connections) {
      upstream.destroy();
      outgoing.destroy();
    }
  };
  return {
    url: 'http://localhost:8081' + selectedPath,
    diagnostics() {
      return { active: connections.size, statuses: [...statuses] };
    },
    disconnect,
    restore() {
      blocked = false;
    },
    async close() {
      disconnect();
      for (const { upstream, outgoing } of allConnections) {
        upstream.destroy();
        outgoing.destroy();
      }
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
