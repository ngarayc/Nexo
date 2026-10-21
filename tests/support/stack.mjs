import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function testStack() {
  const project = `nexo-e0-check-${randomBytes(6).toString('hex')}`;
  const directory = mkdtempSync(join(tmpdir(), 'nexo-test-config-'));
  const envFile = join(directory, 'environment');
  writeFileSync(
    envFile,
    [
      'DB_NAME=nexo',
      'DB_HOST=db',
      'DEMO_ENABLED=true',
      ...['DB_PASSWORD', 'DB_OWNER_PASSWORD', 'SESSION_SECRET', 'INGEST_API_KEY'].map(
        (name) => `${name}=${randomBytes(32).toString('hex')}`,
      ),
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  const compose = (...args) => {
    try {
      return execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          project,
          '--env-file',
          envFile,
          '-f',
          'infra/compose.yaml',
          ...args,
        ],
        {
          encoding: 'utf8',
          timeout: 180000,
          maxBuffer: 8 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ).trim();
    } catch {
      throw new Error(
        'Falló una operación del stack de pruebas. Consultar su estado sin volcar configuración o credenciales.',
      );
    }
  };
  const sql = (statement, { user = 'nexo_owner', expectedError } = {}) => {
    try {
      return execFileSync(
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
          'db',
          'psql',
          '-U',
          user,
          '-d',
          'nexo',
          '--no-psqlrc',
          '--tuples-only',
          '--no-align',
          '--set',
          'ON_ERROR_STOP=1',
          '--set',
          'VERBOSITY=sqlstate',
        ],
        {
          input: statement,
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ).trim();
    } catch (error) {
      if (expectedError && error.stderr?.includes(expectedError)) return expectedError;
    }
    // La salida SQL puede contener credenciales: no se propaga como causa del fallo.
    throw new Error('La comprobación SQL no produjo el resultado esperado.');
  };
  const health = () =>
    JSON.parse(
      compose(
        'exec',
        '-T',
        'api',
        'node',
        '--input-type=module',
        '-e',
        "const r=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(6000)}); console.log(JSON.stringify({status:r.status,body:await r.json(),cache:r.headers.get('cache-control')}));",
      ),
    );
  const expectedFailure = (args) => {
    try {
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
          ...args,
        ],
        {
          encoding: 'utf8',
          timeout: 30000,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      return false;
    } catch (error) {
      return (
        error.status === 1 &&
        `${error.stdout ?? ''}${error.stderr ?? ''}`.includes('No fue posible preparar la base:')
      );
    }
  };
  return {
    compose,
    sql,
    health,
    async waitHealthy() {
      for (let i = 0; i < 20; i += 1) {
        if (health().status === 200) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('La API no recuperó salud dentro del plazo.');
    },
    seedFails() {
      return expectedFailure([
        'exec',
        '-T',
        'api',
        'node',
        '/app/apps/api/dist/platform/database/migrate-main.js',
      ]);
    },
    invalidConfigurationFails() {
      return expectedFailure([
        'run',
        '--rm',
        '-T',
        '--no-deps',
        '-e',
        'SESSION_SECRET=invalid-test-marker',
        'api',
      ]);
    },
    close() {
      try {
        // Solo los recursos del identificador aleatorio creado por esta ejecución.
        compose('down', '--volumes', '--remove-orphans');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
