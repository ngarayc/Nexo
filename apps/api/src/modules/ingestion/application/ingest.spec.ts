import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ingest, IngestionCapacityError, IngestionIdConflict } from './ingest.js';
import { readBatch } from '../domain/batch.js';
import type { Receipt } from './receipt.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = readBatch('{"events":[null]}');
const pending: Receipt = {
  ingestionId: id,
  revision: 0,
  complete: false,
  total: 1,
  accepted: 0,
  duplicates: 0,
  rejected: 0,
  results: [],
  errors: [],
  pendingIndexes: [0],
  failedIndexes: [],
  failures: [],
};
const complete: Receipt = {
  ...pending,
  revision: 1,
  complete: true,
  rejected: 1,
  results: [{ index: 0, eventId: null, outcome: 'rejected' }],
  errors: [{ index: 0, eventId: null, reason: 'INVALID_EVENT' }],
  pendingIndexes: [],
};
const admission = () => ({ admit: vi.fn(async () => 'created' as const) });

describe('espera HTTP independiente de la verdad durable', () => {
  afterEach(() => vi.useRealTimers());

  it('el plazo de admisión no interpreta un commit tardío como rollback ni vuelve a enviar', async () => {
    vi.useFakeTimers();
    let confirm!: () => void;
    const committed = new Promise<'created'>((resolve) => {
      confirm = () => resolve('created');
    });
    const store = { admit: vi.fn(() => committed) };
    const reader = { find: vi.fn() };
    const result = new Ingest(store, reader).execute(
      id,
      input,
      Date.now() + 60000,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(52000);
    expect(await result).toEqual({ state: 'unavailable', ingestionId: id, admission: 'unknown' });
    confirm();
    await Promise.resolve();
    expect(store.admit).toHaveBeenCalledTimes(1);
    expect(reader.find).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('una lectura que no responde queda acotada y conserva la admisión confirmada', async () => {
    vi.useFakeTimers();
    const store = admission();
    const result = new Ingest(store, { find: () => new Promise(() => {}) }).execute(
      id,
      input,
      Date.now() + 60000,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(59000);
    expect(await result).toEqual({ state: 'unavailable', ingestionId: id, admission: 'admitted' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un plazo ya vencido o señal previa no inicia la admisión', async () => {
    const store = admission();
    const reader = { find: vi.fn() };
    const result = await new Ingest(store, reader).execute(
      id,
      input,
      Date.now(),
      new AbortController().signal,
    );
    expect(result).toEqual({ state: 'unavailable', ingestionId: id, admission: 'not_admitted' });
    expect(store.admit).not.toHaveBeenCalled();
    expect(reader.find).not.toHaveBeenCalled();
  });

  it('devuelve el resultado final sin cambiar su clasificación ni volver a admitir', async () => {
    const store = admission();
    const reader = { find: vi.fn(async () => complete) };
    expect(
      await new Ingest(store, reader).execute(
        id,
        input,
        Date.now() + 60000,
        new AbortController().signal,
      ),
    ).toEqual({ state: 'complete', receipt: complete });
    expect(store.admit).toHaveBeenCalledTimes(1);
    expect(reader.find).toHaveBeenCalledTimes(1);
  });

  it('espera cambios sin conexiones retenidas por el caso de uso y reserva el tramo de respuesta', async () => {
    vi.useFakeTimers();
    const store = admission();
    const reader = { find: vi.fn(async () => pending) };
    const result = new Ingest(store, reader).execute(
      id,
      input,
      Date.now() + 60000,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(52000);
    expect(await result).toEqual({ state: 'pending', receipt: pending });
    expect(store.admit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('observa finalización posterior conservando la revisión obtenida', async () => {
    vi.useFakeTimers();
    const store = admission();
    const reader = { find: vi.fn().mockResolvedValueOnce(pending).mockResolvedValue(complete) };
    const result = new Ingest(store, reader).execute(
      id,
      input,
      Date.now() + 60000,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(await result).toEqual({ state: 'complete', receipt: complete });
    expect(store.admit).toHaveBeenCalledTimes(1);
  });

  it('un fallo técnico conserva el prefijo y no lo convierte en rechazo', async () => {
    const receipt = {
      ...pending,
      failedIndexes: [0],
      pendingIndexes: [],
      failures: [{ index: 0, code: 'RETRY_EXHAUSTED' }],
    };
    expect(
      await new Ingest(admission(), { find: async () => receipt }).execute(
        id,
        input,
        Date.now() + 60000,
        new AbortController().signal,
      ),
    ).toEqual({ state: 'failed', receipt });
  });

  it.each([new IngestionIdConflict(), new IngestionCapacityError()])(
    'propaga rechazo previo a admisión sin fabricar recibo',
    async (error) => {
      const reader = { find: vi.fn() };
      const store = { admit: vi.fn().mockRejectedValue(error) };
      await expect(
        new Ingest(store, reader).execute(
          id,
          input,
          Date.now() + 60000,
          new AbortController().signal,
        ),
      ).rejects.toBe(error);
      expect(reader.find).not.toHaveBeenCalled();
      expect(store.admit).toHaveBeenCalledTimes(1);
    },
  );

  it('commit incierto no afirma ausencia de efectos ni reintenta admisión', async () => {
    const store = { admit: vi.fn().mockRejectedValue(new Error('COMMIT_UNCERTAIN')) };
    const reader = { find: vi.fn() };
    expect(
      await new Ingest(store, reader).execute(
        id,
        input,
        Date.now() + 60000,
        new AbortController().signal,
      ),
    ).toEqual({ state: 'unavailable', ingestionId: id, admission: 'unknown' });
    expect(store.admit).toHaveBeenCalledTimes(1);
    expect(reader.find).not.toHaveBeenCalled();
  });

  it('lectura imposible después de admitir conserva la confirmación, sin contadores inventados', async () => {
    const store = admission();
    expect(
      await new Ingest(store, {
        find: async () => {
          throw new Error('READ_FAILED');
        },
      }).execute(id, input, Date.now() + 60000, new AbortController().signal),
    ).toEqual({ state: 'unavailable', ingestionId: id, admission: 'admitted' });
  });

  it('desconectar detiene solo la espera y elimina el temporizador', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const store = admission();
    const reader = { find: vi.fn(async () => pending) };
    const result = new Ingest(store, reader).execute(
      id,
      input,
      Date.now() + 60000,
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toEqual({ state: 'unavailable', ingestionId: id, admission: 'admitted' });
    await vi.advanceTimersByTimeAsync(60000);
    expect(reader.find).toHaveBeenCalledTimes(1);
    expect(store.admit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
