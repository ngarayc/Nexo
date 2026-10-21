export interface IngestionWork {
  readonly ingestionId: string;
  readonly index: number;
  readonly generation: number;
}

export function readWork(value: unknown): IngestionWork | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const work = value as Record<string, unknown>;
  if (
    typeof work['ingestionId'] !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      work['ingestionId'],
    ) ||
    !Number.isInteger(work['index']) ||
    typeof work['index'] !== 'number' ||
    work['index'] < 0 ||
    work['index'] > 999 ||
    !Number.isInteger(work['generation']) ||
    typeof work['generation'] !== 'number' ||
    work['generation'] < 1 ||
    work['generation'] > 3
  )
    return;
  return { ingestionId: work['ingestionId'], index: work['index'], generation: work['generation'] };
}
