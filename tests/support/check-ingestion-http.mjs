import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';

const owner = new Pool(readDatabaseConfig(process.env, true).pool);
const origin = 'http://localhost:8080';
function call(
  proxy,
  path,
  { body, key = true, headers = {}, chunked = false, declaredBytes } = {},
) {
  return new Promise((resolve, reject) => {
    let responseStarted = false;
    const bytes = body === undefined ? undefined : Buffer.from(body);
    const fields = { Host: 'localhost', Connection: 'close', ...headers };
    if (key) fields['X-API-Key'] = key === true ? process.env.INGEST_API_KEY : key;
    if (bytes) {
      fields['Content-Type'] ??= 'application/json';
      if (!chunked) fields['Content-Length'] = String(declaredBytes ?? bytes.length);
    }
    const request = http.request(
      {
        hostname: proxy ? 'web' : '127.0.0.1',
        port: proxy ? 8080 : 3000,
        path,
        method: bytes ? 'POST' : 'GET',
        headers: fields,
        signal: AbortSignal.timeout(90000),
      },
      (response) => {
        responseStarted = true;
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 5 * 1024 * 1024)
            response.destroy(new Error('Respuesta fuera del presupuesto de prueba.'));
          else chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: raw ? JSON.parse(raw) : undefined,
            });
          } catch {
            reject(new Error('La frontera no devolvió JSON verificable.'));
          }
        });
      },
    );
    request.once('error', (error) => {
      if (!responseStarted) reject(error);
    });
    if (bytes && chunked) {
      for (let offset = 0; offset < bytes.length; offset += 8191)
        request.write(bytes.subarray(offset, offset + 8191));
      request.end();
    } else request.end(bytes);
  });
}
const emptyCounts = {
  accepted: 0,
  duplicates: 0,
  rejected: 0,
  errors: [],
  resultsAvailable: false,
};
async function read(proxy, ingestionId, options) {
  return call(proxy, `/api/ingestions/${ingestionId}`, options);
}
const cases = {
  async boundaries() {
    for (const proxy of [false, true]) {
      for (const key of [false, 'invalid']) {
        const denied = await call(proxy, '/api/events/batch', { body: '{', key });
        assert.equal(denied.status, 403);
        assert.equal(denied.body.code, 'INVALID_API_KEY');
        for (const [name, value] of Object.entries(emptyCounts))
          assert.deepEqual(denied.body[name], value);
      }
      for (const [body, status, code] of [
        ['{', 400, 'MALFORMED_JSON'],
        ['{"events":[]}', 400, 'EMPTY_BATCH'],
        ['{"events":null}', 400, 'INVALID_BATCH'],
      ]) {
        const response = await call(proxy, '/api/events/batch', { body });
        assert.equal(response.status, status);
        assert.equal(response.body.code, code);
      }
      const unsupported = await call(proxy, '/api/events/batch', {
        body: '{}',
        headers: { 'Content-Type': 'text/plain' },
      });
      assert.equal(unsupported.status, 415);
      assert.equal(unsupported.body.code, 'UNSUPPORTED_MEDIA_TYPE');
      const excessive = await call(proxy, '/api/events/batch', {
        body: '{',
        declaredBytes: 2 * 1024 * 1024 + 1,
      });
      assert.equal(excessive.status, 413);
      assert.equal(excessive.body.code, 'BODY_TOO_LARGE');
      assert.equal(excessive.headers['cache-control'], 'no-store');
      const prefix = '{"events":[null]}';
      const oversized = prefix + ' '.repeat(2 * 1024 * 1024 + 1 - Buffer.byteLength(prefix));
      const fragmented = await call(proxy, '/api/events/batch', { body: oversized, chunked: true });
      assert.equal(fragmented.status, 413);
      assert.equal(fragmented.body.code, 'BODY_TOO_LARGE');
      const many = await call(proxy, '/api/events/batch', {
        body: JSON.stringify({ events: Array(1001).fill(null) }),
      });
      assert.equal(many.status, 413);
      assert.equal(many.body.code, 'BATCH_TOO_LARGE');
      assert.equal((await call(proxy, '/api/ingestions/bad')).status, 400);
      assert.equal((await read(proxy, randomUUID())).status, 404);
    }
    assert.equal((await owner.query('SELECT count(*) FROM ingestion_batches')).rows[0].count, '0');
    assert.equal((await owner.query('SELECT count(*) FROM ingestion_items')).rows[0].count, '0');
  },
  async durable() {
    const apiId = randomUUID(),
      proxyId = randomUUID();
    const apiBody = JSON.stringify({ events: Array(1000).fill(null) });
    const prefix = ' {"events":[null],"extra":1e400}';
    const proxyBody = prefix + ' '.repeat(2 * 1024 * 1024 - Buffer.byteLength(prefix));
    const started = Date.now();
    const posts = [
      call(false, '/api/events/batch', {
        body: apiBody,
        headers: { 'Idempotency-Key': apiId },
        chunked: true,
      }),
      call(true, '/api/events/batch', { body: proxyBody, headers: { 'Idempotency-Key': proxyId } }),
    ];
    // Registrar los handlers de rechazo inmediatamente, mientras se consulta lo durable.
    const completed = Promise.allSettled(posts);
    for (const [proxy, ingestionId, total] of [
      [false, apiId, 1000],
      [true, proxyId, 1],
    ]) {
      let response;
      for (let count = 0; count < 50; count += 1) {
        response = await read(proxy, ingestionId);
        if (response.status === 200) break;
        assert.equal(response.status, 404);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(response.status, 200);
      assert.equal(response.body.complete, false);
      assert.equal(response.body.total, total);
      assert.equal(response.body.pendingIndexes.length, total);
      assert.equal(response.body.results.length, 0);
      assert.equal(response.body.failedIndexes.length, 0);
      assert.equal(response.body.rejected, 0);
    }
    const reused = call(true, '/api/events/batch', {
      body: apiBody,
      headers: { 'Idempotency-Key': apiId },
    });
    const reusedResult = Promise.allSettled([reused]);
    const conflict = await call(false, '/api/events/batch', {
      body: '{"events":[null],"changed":true}',
      headers: { 'Idempotency-Key': apiId },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'INGESTION_ID_CONFLICT');
    const login = await call(true, '/api/session', {
      body: '{"username":"demo","password":"demo"}',
      key: false,
      headers: { Origin: origin },
    });
    assert.equal(login.status, 200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const demo = await call(true, `/api/demo/ingestions/${apiId}`, {
      key: false,
      headers: { Cookie: cookie },
    });
    assert.equal(demo.status, 200);
    assert.equal(demo.body.ingestionId, apiId);
    assert.equal(demo.body.pendingIndexes.length, 1000);
    assert.equal(
      (await read(true, apiId, { key: false, headers: { Cookie: cookie } })).status,
      403,
    );
    const stored = await owner.query(
      'SELECT ingestion_id,request_document::text,input_bytes::text FROM ingestion_batches ORDER BY total DESC',
    );
    assert.equal(stored.rows.length, 2);
    assert.equal(stored.rows[0].request_document === apiBody, true);
    assert.equal(stored.rows[1].request_document === proxyBody, true);
    assert.equal(stored.rows[0].input_bytes, String(Buffer.byteLength(apiBody) + 1000 * 4));
    assert.equal(stored.rows[1].input_bytes, String(Buffer.byteLength(proxyBody) + 4));
    assert.equal((await owner.query('SELECT count(*) FROM ingestion_items')).rows[0].count, '1001');
    assert.equal((await owner.query('SELECT count(*) FROM pgboss.job')).rows[0].count, '2');
    for (const result of [...(await completed), ...(await reusedResult)]) {
      if (result.status !== 'fulfilled')
        throw new Error('No se recibió una respuesta HTTP verificable.');
      const response = result.value;
      assert.equal(response.status, 503);
      assert.equal(response.body.code, 'INGESTION_RESULT_PENDING');
      assert.equal(response.body.admission, 'admitted');
      assert.equal(response.body.resultsAvailable, true);
      assert.equal(response.body.complete, false);
      assert.equal(response.body.pendingIndexes.length, response.body.total);
      assert.equal(response.body.rejected, 0);
    }
    assert.equal(
      Date.now() - started < 60000,
      true,
      'Respuesta API dentro del plazo total, sin afirmar clasificación.',
    );
  },
  async restart() {
    const ids = await owner.query('SELECT ingestion_id,total FROM ingestion_batches');
    assert.equal(ids.rows.length, 2);
    for (const row of ids.rows) {
      const response = await read(true, row.ingestion_id);
      assert.equal(response.status, 200);
      assert.equal(response.body.total, row.total);
      assert.equal(response.body.pendingIndexes.length, row.total);
    }
    assert.equal((await owner.query('SELECT count(*) FROM pgboss.job')).rows[0].count, '2');
  },
};
try {
  assert.equal(Object.hasOwn(cases, process.env.NEXO_INGESTION_HTTP_CASE), true);
  await cases[process.env.NEXO_INGESTION_HTTP_CASE]();
  console.log('ingestion-http-case-ok');
} finally {
  await owner.end();
}
