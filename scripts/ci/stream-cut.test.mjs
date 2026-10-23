import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { streamCut } from '../../tests/support/stream-cut.mjs';

test('el intermediario rechaza destinos ausentes, ajenos al formato de puerto o canónicos', async () => {
  for (const upstreamPort of [
    '',
    '80',
    '8081',
    '65536',
    '08082',
    '8082/path',
    'http://example.test',
  ])
    await assert.rejects(streamCut({ upstreamPort }), /puerto de loopback/);
});

test('conserva HTTP, cuerpo, sesión y CSP; el bloqueo solo afecta el stream seleccionado', async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: request.url, body, headers: request.headers });
    response.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Security-Policy': "connect-src 'self'",
      'Set-Cookie': 'fixture-session=synthetic; HttpOnly; SameSite=Strict; Path=/',
    });
    response.end('transport-fixture');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let cut;
  try {
    cut = await streamCut({ upstreamPort: String(server.address().port) });
    assert.equal(new URL(cut.url).origin, 'http://localhost:8081');
    const response = await fetch('http://localhost:8081/api/session', {
      method: 'POST',
      body: '{"fixture":true}',
      headers: {
        Cookie: 'fixture-session=synthetic',
        Origin: 'http://localhost:8081',
        'Content-Type': 'application/json',
      },
    });
    assert.equal(await response.text(), 'transport-fixture');
    assert.equal(response.headers.get('content-security-policy'), "connect-src 'self'");
    assert.equal(
      response.headers.get('set-cookie'),
      'fixture-session=synthetic; HttpOnly; SameSite=Strict; Path=/',
    );
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].body, '{"fixture":true}');
    assert.equal(requests[0].headers.cookie, 'fixture-session=synthetic');
    assert.equal(requests[0].headers.origin, 'http://localhost:8081');
    assert.equal(requests[0].headers.host, 'localhost:8081');
    const initial = await fetch(cut.url);
    assert.equal(initial.status, 200);
    await initial.text();
    assert.equal(requests.at(-1).path, '/api/stream');
    cut.disconnect();
    const before = requests.length;
    const blocked = await fetch(cut.url);
    assert.equal(blocked.status, 503);
    assert.equal(blocked.headers.get('retry-after'), '2');
    await blocked.text();
    assert.equal(requests.length, before);
    for (const path of ['/api/health', '/api/stream']) {
      const independent = await fetch('http://localhost:8081' + path);
      assert.equal(independent.status, 200);
      await independent.text();
    }
    cut.restore();
    const restored = await fetch(cut.url);
    assert.equal(restored.status, 200);
    await restored.text();
    assert.deepEqual(cut.diagnostics().statuses, [200, 200]);
  } finally {
    if (cut) await cut.close();
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
