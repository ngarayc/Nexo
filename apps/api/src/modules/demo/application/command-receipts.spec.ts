import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ReplayCommandReceipts, ReplayControlCapacity } from './command-receipts.js';
import { readReplayCommand } from '../domain/command.js';
import { ReplayConflict } from '../domain/replay.js';
const command = () =>
  readReplayCommand({
    commandId: randomUUID(),
    instanceId: randomUUID(),
    expectedControlVersion: 0,
    runId: null,
    action: 'start',
  });
describe('recibos operativos acotados, distintos de la ingesta durable', () => {
  it('conserva admisión original y normaliza duplicado; cambio de intención entra en conflicto', () => {
    const receipts = new ReplayCommandReceipts(),
      request = command(),
      admission = receipts.record(request, randomUUID(), 1);
    expect(receipts.find(request)?.admission).toBe(admission);
    expect(() => receipts.find({ ...request, intervalMs: 100 })).toThrow(ReplayConflict);
    receipts.resolve(request.commandId);
    expect(receipts.get(request.commandId)).toEqual({
      admission,
      resolution: 'completed',
      reasonCode: null,
    });
    expect(Object.isFrozen(admission)).toBe(true);
  });
  it('expira a10minutos desde admisión, sin renovar por lectura o resolución', () => {
    let now = 100;
    const receipts = new ReplayCommandReceipts(() => now),
      request = command();
    receipts.record(request, randomUUID(), 1);
    now = 600099;
    expect(receipts.find(request)).toBeDefined();
    receipts.resolve(request.commandId, 'RESPONSE_PENDING');
    expect(receipts.get(request.commandId)?.resolution).toBe('failed');
    now++;
    expect(receipts.get(request.commandId)).toBeUndefined();
  });
  it('retiene pendientes aunque transcurra el plazo y no los expulsa para admitir otro', () => {
    let now = 0;
    const receipts = new ReplayCommandReceipts(() => now),
      first = command();
    receipts.record(first, randomUUID(), 1);
    for (let index = 1; index < 1024; index++) receipts.record(command(), randomUUID(), index + 1);
    now = 600001;
    expect(receipts.get(first.commandId)?.resolution).toBe('pending');
    expect(() => receipts.ensureCapacity()).toThrow(ReplayControlCapacity);
    receipts.resolve(first.commandId);
    expect(receipts.get(first.commandId)).toBeUndefined();
    expect(() => receipts.ensureCapacity()).not.toThrow();
  });
});
