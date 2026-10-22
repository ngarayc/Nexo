import { createServer, request } from 'node:http';

// Solo transporta el SSE real del stack de pruebas en loopback. El corte
// destruye sockets: no fabrica mensajes ni llama métodos de Angular.
export async function streamCut() {
  let blocked = false;
  const connections = new Set();
  const statuses = [];
  const server = createServer((incoming, outgoing) => {
    if (incoming.method !== 'GET' || incoming.url !== '/api/stream') {
      outgoing.writeHead(404).end();
      return;
    }
    if (blocked) {
      outgoing.writeHead(503, { 'Retry-After': '2' }).end();
      return;
    }
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: 8081,
        path: '/api/stream',
        headers: { ...incoming.headers, host: 'localhost:8081' },
      },
      (response) => {
        statuses.push(response.statusCode);
        outgoing.writeHead(response.statusCode, response.headers);
        response.on('error', () => outgoing.destroy());
        response.pipe(outgoing);
      },
    );
    const pair = { upstream, outgoing };
    connections.add(pair);
    upstream.on('error', () => outgoing.destroy());
    outgoing.on('close', () => {
      upstream.destroy();
      connections.delete(pair);
    });
    upstream.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const disconnect = () => {
    blocked = true;
    for (const { upstream, outgoing } of connections) {
      upstream.destroy();
      outgoing.destroy();
    }
  };
  return {
    url: `http://localhost:${server.address().port}/api/stream`,
    diagnostics() {
      return { active: connections.size, statuses: [...statuses] };
    },
    disconnect,
    restore() {
      blocked = false;
    },
    async close() {
      disconnect();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
