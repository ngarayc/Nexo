import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import type { ReplayControl, ReplayDetailDto } from '@nexo/contracts';
import { ReplayFacade } from './replay-facade';
import { ReplayPanel } from './replay-panel';
const id = '00000000-0000-4000-8000-000000000001';
function setup() {
  const view = signal<ReplayControl>({
    instanceId: id,
    viewRevision: 1,
    controlVersion: 1,
    observedAt: '2026-01-01T18:00:00Z',
    allowedActions: ['pause'],
    pendingAction: null,
    blockedReason: null,
    scenario: { scenarioId: id, verification: 'pending', closedAt: null },
    run: {
      runId: id,
      scenarioId: id,
      stage: 'first',
      state: 'running',
      verification: 'pending',
      intervalMs: 750,
      nextLine: 2,
      closeCode: null,
      progress: {
        total: 24,
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        classified: 1,
        inFlight: 0,
        uncertain: 0,
        technicalFailure: 0,
        unattempted: 23,
        nextLine: 2,
      },
    },
  });
  const detail = signal<ReplayDetailDto | null>(null),
    stale = signal(false);
  const facade = {
    view,
    detail,
    stale,
    pending: signal(null),
    notice: signal(null),
    error: signal(null),
    preparation: signal(null),
    selectedRunId: signal(null),
    history: signal([]),
    historyCursor: signal(null),
    can: vi.fn((action: string) => !stale() && view().allowedActions.includes(action as 'pause')),
    execute: vi.fn(async () => {}),
    refresh: vi.fn(),
    checkReceipt: vi.fn(),
    selectRun: vi.fn(),
    loadHistory: vi.fn(),
    reason: () => 'Diagnóstico conservado.',
  };
  TestBed.configureTestingModule({
    imports: [ReplayPanel],
    providers: [{ provide: ReplayFacade, useValue: facade }],
  });
  const fixture = TestBed.createComponent(ReplayPanel);
  return { fixture, root: fixture.nativeElement as HTMLElement, facade, view, detail, stale };
}
it('minimizar solo cambia presentación; botones usan las acciones permitidas y muestran24confirmados', async () => {
  const { fixture, root, facade, stale } = setup();
  await fixture.whenStable();
  expect(root.querySelector('#replay-body')).toBeNull();
  (root.querySelector('.toggle') as HTMLButtonElement).click();
  await fixture.whenStable();
  expect(root.textContent).toContain('Resultados confirmados: 1 de 24');
  const pause = [...root.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Pausar',
  )!;
  expect(pause.disabled).toBe(false);
  pause.click();
  expect(facade.execute).toHaveBeenCalledExactlyOnceWith('pause', 750);
  stale.set(true);
  await fixture.whenStable();
  expect(pause.disabled).toBe(true);
  expect(root.textContent).toContain('Estado desactualizado');
  (root.querySelector('.toggle') as HTMLButtonElement).click();
  await fixture.whenStable();
  expect(facade.execute).toHaveBeenCalledTimes(1);
});
it('teclado mueve pestañas y el inspector mantiene24líneas sin inventar intentos exitosos', async () => {
  const { fixture, root, detail } = setup();
  fixture.componentInstance.minimized.set(false);
  detail.set({
    run: {
      runId: id,
      scenarioId: id,
      previousRunId: null,
      instanceId: id,
      stage: 'first',
      state: 'running',
      intervalMs: 750,
      nextLine: 2,
      revision: 1,
      verification: 'pending',
      closeCode: null,
      createdAt: '2026-01-01T18:00:00Z',
      updatedAt: '2026-01-01T18:00:00Z',
    },
    progress: {
      total: 24,
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      classified: 1,
      inFlight: 0,
      uncertain: 0,
      technicalFailure: 0,
      unattempted: 23,
      nextLine: 2,
    },
    scenario: { scenarioId: id, verification: 'pending', closedAt: null, report: null },
    attempts: [],
    inspection: {
      report: {} as ReplayDetailDto['inspection']['report'],
      currentState: 'unavailable',
      currentObservedAt: null,
    },
  });
  await fixture.whenStable();
  root
    .querySelector('#replay-control-tab')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await fixture.whenStable();
  expect(fixture.componentInstance.tab()).toBe('deliveries');
  expect(root.querySelector('#replay-deliveries-tab')?.getAttribute('tabindex')).toBe('0');
  expect(root.querySelectorAll('tbody tr')).toHaveLength(24);
  expect(root.textContent).toContain('Sin intentar');
  expect(root.textContent).toContain('índice de lote 0');
});
it('verificación muestra diferencias y valores como texto con hora Bogotá24h', async () => {
  const { fixture, root, detail } = setup();
  fixture.componentInstance.minimized.set(false);
  fixture.componentInstance.tab.set('verification');
  const marker = '<img src=x onerror=alert(1)>';
  const report = {
    version: 1 as const,
    scope: 'data-and-replays' as const,
    phase: 'first' as const,
    result: 'non_conformant' as const,
    observedAt: '2026-01-01T18:00:00Z',
    attemptedAt: '2026-01-01T18:00:00Z',
    runId: id,
    scenarioId: id,
    runRevision: 1,
    environment: null,
    sources: {},
    snapshotFingerprint: null,
    checks: [
      {
        key: 'identity',
        label: 'Identidad del evento',
        source: 'Fuente original',
        expected: 'Evento original',
        observed: marker,
        state: 'differs' as const,
      },
    ],
    externalEvidence: {
      twoRenderedClients: 'not_assessed' as const,
      pauseResume: 'not_assessed' as const,
      ci: 'not_assessed' as const,
    },
  };
  detail.set({
    run: { runId: id, verification: 'non_conformant' } as ReplayDetailDto['run'],
    progress: {} as ReplayDetailDto['progress'],
    attempts: [],
    scenario: { scenarioId: id, verification: 'pending', closedAt: null, report: null },
    inspection: { report, currentState: 'changed', currentObservedAt: '2026-01-01T18:00:00Z' },
  });
  await fixture.whenStable();
  expect(root.textContent).toContain('Difiere');
  expect(root.textContent).toContain('No conforme');
  expect(root.textContent).toContain(marker);
  expect(root.querySelector('img')).toBeNull();
  expect(root.textContent).toContain('13:00:00');
  expect(root.textContent).toContain('estado actual cambió');
  detail.update((value) =>
    value ? { ...value, run: { ...value.run, verification: 'pending' } } : null,
  );
  await fixture.whenStable();
  expect(root.textContent).toContain('Resultado del recorrido: Pendiente');
  expect(root.textContent).not.toContain('Informe individual conservado');
});
