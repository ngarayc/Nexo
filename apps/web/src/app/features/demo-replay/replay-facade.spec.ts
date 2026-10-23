import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReplayControl, ReplayStreamFrame } from '@nexo/contracts';
import { ReplayApi } from '../../platform/replay/replay-api';
import { LIVE_CLOCK } from '../../platform/telemetry/stream-transport';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import { ReplayFacade } from './replay-facade';
const id = '00000000-0000-4000-8000-000000000001';
const control = (revision = 0): ReplayControl => ({
  instanceId: id,
  viewRevision: revision,
  controlVersion: revision,
  observedAt: new Date().toISOString(),
  allowedActions: ['start'],
  pendingAction: null,
  blockedReason: null,
  scenario: null,
  run: null,
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
let active: ReplayFacade | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  active?.ngOnDestroy();
  active = undefined;
  vi.useRealTimers();
});
function setup() {
  let ready!: (generation: number) => void,
    replay!: (view: ReplayStreamFrame, generation: number) => void,
    invalidated!: (clear: boolean) => void;
  const monitor = {
    currentGeneration: 1 as number | undefined,
    retryWait: 0,
    reconnect: vi.fn(),
    noteRetryAfter: vi.fn(),
    onReady: (listener: typeof ready) => {
      ready = listener;
      return () => {};
    },
    onReplay: (listener: typeof replay) => {
      replay = listener;
      return () => {};
    },
    onInvalidated: (listener: typeof invalidated) => {
      invalidated = listener;
      return () => {};
    },
  };
  const api = {
    reset: vi.fn<ReplayApi['reset']>(async () => {}),
    current: vi.fn<ReplayApi['current']>(async () => control()),
    command: vi.fn<ReplayApi['command']>(async () => ({
      commandId: id,
      instanceId: id,
      runId: id,
      admittedControlVersion: 1,
      accepted: true,
    })),
    receipt: vi.fn<ReplayApi['receipt']>(async () => ({
      admission: {
        commandId: id,
        instanceId: id,
        runId: id,
        admittedControlVersion: 1,
        accepted: true,
      },
      resolution: 'pending',
      reasonCode: null,
    })),
    detail: vi.fn(),
    history: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ReplayApi, useValue: api },
      { provide: LiveMonitor, useValue: monitor },
      {
        provide: LIVE_CLOCK,
        useValue: {
          now: () => Date.now(),
          wall: () => Date.now(),
          after: (ms: number, callback: () => void) => {
            const timer = setTimeout(callback, ms);
            return () => clearTimeout(timer);
          },
        },
      },
    ],
  });
  const facade = TestBed.inject(ReplayFacade);
  active = facade;
  return {
    facade,
    api,
    monitor,
    ready: (generation = 1) => ready(generation),
    replay: (view: ReplayControl, generation = 1) =>
      replay(
        { ...view, type: 'demo.replay.updated', schemaVersion: 1, streamInstanceId: id },
        generation,
      ),
    invalidated,
  };
}
it('limpiar bloquea otros controles, vacía historial local y resincroniza sin repetir el POST', async () => {
  const { facade, api, ready, monitor } = setup();
  ready();
  await flush();
  expect(facade.canReset()).toBe(true);
  let finish!: () => void;
  api.reset.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const pending = facade.reset();
  expect(facade.can('start')).toBe(false);
  await facade.reset();
  expect(api.reset).toHaveBeenCalledTimes(1);
  finish();
  await pending;
  expect(facade.view()).toBeNull();
  expect(facade.detail()).toBeNull();
  expect(facade.history()).toEqual([]);
  expect(monitor.reconnect).toHaveBeenCalledOnce();
  expect(facade.notice()).toContain('Demostración limpia');
});
it('no repite una limpieza con respuesta perdida ni la presenta como completada', async () => {
  const { facade, api, ready, monitor } = setup();
  ready();
  await flush();
  api.reset.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
  await facade.reset();
  await flush();
  expect(api.reset).toHaveBeenCalledTimes(1);
  expect(facade.error()).toContain('No se pudo confirmar');
  expect(monitor.reconnect).toHaveBeenCalledOnce();
  expect(facade.resetting()).toBe(false);
});
it('registra manejadores antes del GET y una respuesta vieja no reemplaza la vista SSE nueva', async () => {
  const { facade, api, ready, replay } = setup();
  let resolve!: (view: ReplayControl) => void;
  api.current.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  ready();
  replay(control(3));
  resolve(control(1));
  await flush();
  expect(facade.view()?.viewRevision).toBe(3);
  expect(facade.stale()).toBe(false);
  replay(control(3));
  expect(facade.view()?.viewRevision).toBe(3);
});
it('diez segundos sin resumen verificado bloquean órdenes hasta recuperar el control', async () => {
  const { facade, api, ready } = setup();
  ready();
  await flush();
  expect(facade.can('start')).toBe(true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(facade.stale()).toBe(true);
  await facade.execute('start', 750);
  expect(api.command).not.toHaveBeenCalled();
  await facade.refresh();
  expect(facade.can('start')).toBe(true);
});
it('invalidación descarta respuestas de consulta y callbacks de la generación anterior', async () => {
  const { facade, api, monitor, ready, replay, invalidated } = setup();
  let resolve!: (view: ReplayControl) => void;
  api.current.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  ready();
  const signal = api.current.mock.calls[0]![0] as AbortSignal;
  invalidated(false);
  monitor.currentGeneration = 2;
  ready(2);
  await flush();
  resolve(control(100));
  replay(control(200), 1);
  await flush();
  expect(signal.aborted).toBe(true);
  expect(facade.view()?.viewRevision).toBe(0);
});
it('intervalo inválido no envía; doble intención mientras hay una pendiente no repite POST', async () => {
  const { facade, api, ready } = setup();
  ready();
  await flush();
  await facade.execute('start', NaN);
  expect(api.command).not.toHaveBeenCalled();
  await facade.execute('start', 750);
  await facade.execute('start', 750);
  expect(api.command).toHaveBeenCalledTimes(1);
  expect(api.command.mock.calls[0]![0]).toMatchObject({
    action: 'start',
    instanceId: id,
    expectedControlVersion: 0,
    runId: null,
    intervalMs: 750,
  });
  expect(facade.pending()?.commandId).toMatch(/^[a-f0-9-]{36}$/);
});
it('respuesta de admisión perdida conserva commandId y consulta sin reenviar o inventar rechazo', async () => {
  const { facade, api, ready } = setup();
  ready();
  await flush();
  api.command.mockRejectedValueOnce(new Error('synthetic-lost-response'));
  api.receipt.mockRejectedValue(
    new HttpErrorResponse({ status: 404, error: { code: 'COMMAND_RECEIPT_UNAVAILABLE' } }),
  );
  await facade.execute('start', 750);
  const commandId = facade.pending()!.commandId;
  await vi.advanceTimersByTimeAsync(16000);
  expect(api.command).toHaveBeenCalledTimes(1);
  expect(facade.pending()?.commandId).toBe(commandId);
  expect(facade.notice()).toContain('No se reenviará');
  expect(api.receipt.mock.calls.every((call) => call[0] === commandId && call[1] === id)).toBe(
    true,
  );
});
it('cambiar instancia API conserva incertidumbre explicada y no reenvía la orden antigua', async () => {
  const { facade, api, ready, replay } = setup();
  ready();
  await flush();
  await facade.execute('start', 750);
  expect(facade.pending()).not.toBeNull();
  facade.historyCursor.set('cursor-anterior');
  replay({ ...control(), instanceId: '00000000-0000-4000-8000-000000000002' });
  await flush();
  expect(facade.pending()).toBeNull();
  expect(facade.historyCursor()).toBeNull();
  expect(facade.notice()).toContain('API se reinició');
  expect(api.command).toHaveBeenCalledTimes(1);
});
it('rechazo conocido conserva un mensaje legible después de refrescar el estado', async () => {
  const { facade, api, ready } = setup();
  ready();
  await flush();
  api.command.mockRejectedValueOnce(
    new HttpErrorResponse({ status: 409, error: { code: 'REPLAY_CONFLICT' } }),
  );
  await facade.execute('start', 750);
  expect(facade.pending()).toBeNull();
  expect(facade.error()).toContain('estado cambió');
});
it('respeta Retry-After incluso infinito sin temporizadores rápidos o nuevos envíos', async () => {
  const { facade, api, monitor, ready } = setup();
  ready();
  await flush();
  await facade.execute('start', 750);
  await flush();
  const reads = api.receipt.mock.calls.length;
  monitor.retryWait = Infinity;
  facade.checkReceipt();
  await vi.advanceTimersByTimeAsync(16000);
  expect(api.receipt).toHaveBeenCalledTimes(reads);
  const currentReads = api.current.mock.calls.length;
  await facade.refresh();
  expect(api.current).toHaveBeenCalledTimes(currentReads);
  expect(facade.can('start')).toBe(false);
  expect(api.command).toHaveBeenCalledTimes(1);
});
it('un fallo tardío del POST no reemplaza la resolución durable ya consultada', async () => {
  const { facade, api, ready } = setup();
  ready();
  await flush();
  let reject!: (error: unknown) => void;
  api.command.mockReturnValueOnce(
    new Promise((_, no) => {
      reject = no;
    }),
  );
  const pending = facade.execute('start', 750);
  const commandId = facade.pending()!.commandId;
  api.receipt.mockResolvedValueOnce({
    admission: { commandId, instanceId: id, runId: id, admittedControlVersion: 1, accepted: true },
    resolution: 'completed',
    reasonCode: null,
  });
  facade.checkReceipt();
  await flush();
  expect(facade.pending()).toBeNull();
  expect(facade.notice()).toBe('Orden completada.');
  reject(new Error('synthetic-late-post-response-loss'));
  await pending;
  expect(facade.notice()).toBe('Orden completada.');
  expect(api.command).toHaveBeenCalledTimes(1);
});
