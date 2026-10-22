import { expect, it } from 'vitest';
import {
  readReplayControl,
  readReplayFrame,
  readReplayReceipt,
  readReplayHistory,
} from './replay-contract';
const id = '00000000-0000-4000-8000-000000000001';
const initial = () => ({
  instanceId: id,
  controlVersion: 0,
  viewRevision: 0,
  observedAt: '2026-01-01T00:00:00Z',
  blockedReason: null,
  allowedActions: ['start'],
  pendingAction: null,
  scenario: null,
  run: null,
});
it('conserva una representación completa sin sumar sus contadores al recibirla otra vez', () => {
  const value = initial();
  expect(readReplayControl(value)).toBe(value);
  expect(readReplayControl(value)).toEqual(value);
});
it('una partición incierta no equivale a rechazados o 24 resultados confirmados', () => {
  const value = {
    ...initial(),
    allowedActions: [],
    scenario: { scenarioId: id, verification: 'pending', closedAt: null },
    run: {
      runId: id,
      scenarioId: id,
      stage: 'first',
      state: 'error',
      verification: 'inconclusive',
      intervalMs: 750,
      nextLine: 2,
      closeCode: 'TRANSPORT_UNCERTAIN',
      progress: {
        total: 24,
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        classified: 1,
        inFlight: 0,
        uncertain: 1,
        technicalFailure: 0,
        unattempted: 22,
        nextLine: 2,
      },
    },
  };
  expect(readReplayControl(value).run?.progress.uncertain).toBe(1);
  for (const progress of [
    { ...value.run.progress, classified: 24 },
    { ...value.run.progress, rejected: 1 },
    { ...value.run.progress, unattempted: 23 },
    { ...value.run.progress, nextLine: 3 },
  ])
    expect(() => readReplayControl({ ...value, run: { ...value.run, progress } })).toThrow();
});
it('rechaza revisiones inseguras, controles desconocidos, identificadores y fechas inválidos', () => {
  for (const patch of [
    { controlVersion: -1 },
    { viewRevision: Number.MAX_SAFE_INTEGER + 1 },
    { allowedActions: ['delete'] },
    { allowedActions: ['start', 'start'] },
    { observedAt: 'ayer' },
    { instanceId: 'other' },
    { pendingAction: 'delete' },
    { blockedReason: 'OK' },
  ])
    expect(() => readReplayControl({ ...initial(), ...patch })).toThrow();
});
it('el frame distingue instancia API de época SSE y limita tamaño/formato', () => {
  const frame = {
    ...initial(),
    type: 'demo.replay.updated',
    schemaVersion: 1,
    streamInstanceId: '00000000-0000-4000-8000-000000000002',
  };
  expect(readReplayFrame(JSON.stringify(frame)).instanceId).not.toBe(frame.streamInstanceId);
  for (const data of [
    '{',
    ' '.repeat(16385),
    JSON.stringify({ ...frame, schemaVersion: 2 }),
    JSON.stringify({ ...frame, streamInstanceId: null }),
  ])
    expect(() => readReplayFrame(data)).toThrow();
});
it('un recibo debe corresponder a la intención y separar fallo de pendiente/completado', () => {
  const admission = {
    commandId: id,
    instanceId: id,
    runId: id,
    admittedControlVersion: 1,
    accepted: true,
  };
  expect(
    readReplayReceipt({ admission, resolution: 'pending', reasonCode: null }, id, id).resolution,
  ).toBe('pending');
  for (const value of [
    { admission: { ...admission, commandId: 'other' }, resolution: 'pending', reasonCode: null },
    { admission, resolution: 'completed', reasonCode: 'ERROR' },
    { admission, resolution: 'failed', reasonCode: null },
  ])
    expect(() => readReplayReceipt(value, id, id)).toThrow();
});
it('historial fuera del límite o con cursor no comprobable no se presenta como vacío', () => {
  expect(readReplayHistory({ items: [], nextCursor: null }).items).toEqual([]);
  for (const value of [
    { items: new Array(101).fill({}), nextCursor: null },
    { items: [], nextCursor: 'x'.repeat(513) },
    { items: [], nextCursor: '../bad' },
    { items: [{ runId: id }], nextCursor: null },
  ])
    expect(() => readReplayHistory(value)).toThrow();
});
