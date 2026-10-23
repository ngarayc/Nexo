export function readDemoCredentials(env: NodeJS.ProcessEnv): {
  username: 'demo' | 'Demo';
  password: string;
} {
  const username = env['DEMO_USERNAME'];
  const password = env['DEMO_PASSWORD'];
  if (!username && !password && !env['PUBLIC_ORIGIN']?.startsWith('https:'))
    return { username: 'demo', password: 'demo' };
  if (
    username !== 'Demo' ||
    typeof password !== 'string' ||
    Buffer.byteLength(password, 'utf8') < 10 ||
    Buffer.byteLength(password, 'utf8') > 256 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^a-zA-Z0-9]/.test(password)
  )
    throw new Error('Configura credenciales privadas válidas para la cuenta de demostración.');
  return { username, password };
}
