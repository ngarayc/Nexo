import { systemApiScript } from './system-runtime.mjs';

export function produceSystemEvents(events) {
  const source = `
    import http from 'node:http';
    try {
      const bytes = Buffer.from(JSON.stringify({ events: ${JSON.stringify(events)} }));
      const response = await new Promise((resolve, reject) => {
        const request = http.request({ hostname: 'web', port: 8080, path: '/api/events/batch',
          method: 'POST', signal: AbortSignal.timeout(10000),
          headers: { Host: 'localhost', 'Content-Type': 'application/json', 'Content-Length': bytes.length,
            'X-API-Key': process.env.INGEST_API_KEY },
        }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
            catch { reject(new Error()); }
          });
        });
        request.on('error', reject);
        request.end(bytes);
      });
      if (response.status !== 200) throw new Error();
      const result = response.body;
      if (result.complete !== true) throw new Error();
      console.log(JSON.stringify({ accepted: result.accepted, duplicates: result.duplicates, rejected: result.rejected }));
    } catch { process.stderr.write('Productor sintético no aprobado.'); process.exitCode = 1; }
  `;
  try {
    return JSON.parse(systemApiScript(source));
  } catch {
    throw new Error('No se completó la ingesta del productor sintético de sistema.');
  }
}
