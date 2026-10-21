import { afterEach, expect, it, vi } from 'vitest';
import { ReconcileIngestion } from './reconcile.js';
import type { InspectionCandidate, InspectionCursor, RecoveryInspection } from './reconcile.js';

function candidate(index: number): InspectionCandidate {
  const ingestionId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
  return {
    cursor: { receivedAt: '2026-01-01T00:00:00Z', ingestionId },
    work: { ingestionId, index: 0, generation: 1 },
    jobId: ingestionId,
  };
}
const position = (cursor: InspectionCursor | undefined) =>
  cursor ? parseInt(cursor.ingestionId.slice(-12), 16) : 0;
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

it('limita la pasada a 100, avanza más allá de ocupados y retoma por cursor antes de volver al inicio', async () => {
  const page = vi.fn(async (cursor: InspectionCursor | undefined) =>
    Array.from({ length: 20 }, (_, offset) => candidate(position(cursor) + offset + 1)).filter(
      (c) => position(c.cursor) <= 120,
    ),
  );
  const inspection: RecoveryInspection = {
    page,
    recover: vi.fn(async (_id, data) => {
      const work = data as { ingestionId: string };
      return position({ receivedAt: '', ingestionId: work.ingestionId }) <= 20
        ? 'skipped'
        : 'waiting';
    }),
  };
  const reconcile = new ReconcileIngestion(inspection);
  expect(await reconcile.runPass(signal())).toEqual({
    inspected: 100,
    changed: 0,
    skipped: 20,
    unverified: 0,
  });
  expect(page).toHaveBeenCalledTimes(5);
  expect(await reconcile.runPass(signal())).toMatchObject({ inspected: 20 });
  expect(position(page.mock.calls[5]?.[0])).toBe(100);
  expect(await reconcile.runPass(signal())).toMatchObject({ inspected: 100 });
});

it('una lectura fallida o identidad incoherente no se convierten en reposición asumida', async () => {
  const candidates = [candidate(1), { ...candidate(2), work: undefined }, candidate(3)];
  const recover = vi
    .fn()
    .mockRejectedValueOnce(new Error('DB_UNREADABLE'))
    .mockResolvedValue('scheduled');
  const page = vi.fn().mockResolvedValueOnce(candidates).mockResolvedValue([]);
  expect(await new ReconcileIngestion({ page, recover }).runPass(signal())).toEqual({
    inspected: 3,
    changed: 1,
    skipped: 0,
    unverified: 2,
  });
  expect(recover).toHaveBeenCalledTimes(2);
});

it('una pasada en ejecución excluye otra y la cancelación evita iniciar la siguiente consulta', async () => {
  let finish: ((items: InspectionCandidate[]) => void) | undefined;
  const page = vi.fn(
    () =>
      new Promise<InspectionCandidate[]>((resolve) => {
        finish = resolve;
      }),
  );
  const recover = vi.fn().mockResolvedValue('waiting');
  const reconcile = new ReconcileIngestion({ page, recover });
  const controller = new AbortController();
  const first = reconcile.runPass(controller.signal);
  expect(await reconcile.runPass(signal())).toBeUndefined();
  controller.abort();
  finish?.([candidate(1)]);
  expect(await first).toMatchObject({ inspected: 0 });
  expect(page).toHaveBeenCalledOnce();
  expect(recover).not.toHaveBeenCalled();
});

it('la pasada también limita duración y conserva el cursor tras un trabajo lento', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const page = vi.fn().mockResolvedValue([candidate(1), candidate(2)]);
  const recover = vi.fn(async () => {
    vi.setSystemTime(Date.now() + 10001);
    return 'waiting' as const;
  });
  const reconcile = new ReconcileIngestion({ page, recover });
  expect(await reconcile.runPass(signal())).toMatchObject({ inspected: 1 });
  expect(recover).toHaveBeenCalledOnce();
});
