import { execFileSync } from 'node:child_process';
import { isAbsolute, basename, dirname } from 'node:path';

export function produceSystemEvents(events) {
  const project = process.env.NEXO_SYSTEM_PROJECT;
  const envFile = process.env.NEXO_SYSTEM_ENV_FILE;
  if (
    !/^nexo-e0-check-[a-f0-9]{12}$/.test(project ?? '') ||
    !envFile ||
    !isAbsolute(envFile) ||
    basename(envFile) !== 'environment' ||
    !basename(dirname(envFile)).startsWith('nexo-test-config-')
  )
    throw new Error('Falta el stack sintético propio del runner de sistema.');
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
    return JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          project,
          '--env-file',
          envFile,
          '-f',
          'infra/compose.yaml',
          'exec',
          '-T',
          'api',
          'node',
          '--input-type=module',
          '-e',
          source,
        ],
        { encoding: 'utf8', timeout: 35000, stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
  } catch {
    throw new Error('No se completó la ingesta del productor sintético de sistema.');
  }
}
