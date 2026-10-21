export interface Credentials {
  readonly username: string;
  readonly password: string;
}

export function readCredentials(value: unknown): Credentials | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const { username, password } = value as Record<string, unknown>;
  const valid = (field: unknown, maximum: number): field is string =>
    typeof field === 'string' &&
    new TextEncoder().encode(field).byteLength >= 1 &&
    new TextEncoder().encode(field).byteLength <= maximum;
  if (!valid(username, 64) || !valid(password, 256)) return;
  return { username, password };
}
