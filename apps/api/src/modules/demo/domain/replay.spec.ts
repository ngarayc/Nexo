import { describe, expect, it } from 'vitest';
import {
  replayDiagnostic,
  replayInterval,
  replayProgress,
  ReplayInputError,
  ReplayInvariantError,
} from './replay.js';
import type { AttemptPosition } from './replay.js';

describe('diario del emisor, sin atribuir respuesta a un resultado incierto', () => {
  it('comienza con24líneas sin intentar y ningún resultado confirmado', () => {
    expect(replayProgress([])).toEqual({
      total: 24,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      classified: 0,
      inFlight: 0,
      uncertain: 0,
      technicalFailure: 0,
      unattempted: 24,
      nextLine: 1,
    });
  });
  it.each(['in_flight', 'uncertain', 'technical_failure'] as const)(
    '%s conserva el prefijo confirmado y su propia partición',
    (state) => {
      const view = replayProgress([
        { lineNumber: 1, state: 'classified', outcome: 'accepted' },
        { lineNumber: 2, state: 'classified', outcome: 'rejected' },
        { lineNumber: 3, state, outcome: null },
      ]);
      expect(view.accepted).toBe(1);
      expect(view.rejected).toBe(1);
      expect(view.duplicates).toBe(0);
      expect(
        view.classified + view.inFlight + view.uncertain + view.technicalFailure + view.unattempted,
      ).toBe(24);
      expect(view.nextLine).toBe(3);
      expect(view.unattempted).toBe(21);
    },
  );
  it('24clasificaciones tienen cursor25 sin posiciones nuevas disponibles', () => {
    const attempts = Array.from({ length: 24 }, (_, index) => ({
      lineNumber: index + 1,
      state: 'classified' as const,
      outcome: 'duplicate' as const,
    }));
    expect(replayProgress(attempts)).toMatchObject({
      duplicates: 24,
      nextLine: 25,
      unattempted: 0,
    });
  });
  it.each([
    [{ lineNumber: 0, state: 'in_flight', outcome: null }],
    [{ lineNumber: 25, state: 'in_flight', outcome: null }],
    [{ lineNumber: 1.5, state: 'in_flight', outcome: null }],
    [{ lineNumber: 2, state: 'classified', outcome: 'accepted' }],
    [{ lineNumber: 1, state: 'classified', outcome: null }],
    [{ lineNumber: 1, state: 'uncertain', outcome: 'accepted' }],
    [
      { lineNumber: 1, state: 'classified', outcome: 'accepted' },
      { lineNumber: 1, state: 'classified', outcome: 'accepted' },
    ],
    [
      { lineNumber: 1, state: 'in_flight', outcome: null },
      { lineNumber: 2, state: 'in_flight', outcome: null },
    ],
  ] as AttemptPosition[][])(
    'rechaza prefijo, identidad o desenlace incoherentes: %j',
    (...attempts) => {
      expect(() => replayProgress(attempts)).toThrow(ReplayInvariantError);
    },
  );
  it.each([100, 750, 5000])('admite el intervalo entero%s', (interval) => {
    expect(replayInterval(interval)).toBe(interval);
  });
  it.each([99, 5001, 100.5, '750', null, NaN, Infinity])('no convierte intervalo%s', (interval) => {
    expect(() => replayInterval(interval)).toThrow(ReplayInputError);
  });
  it('solo conserva diagnóstico permitido y señala el contenido descartado', () => {
    const document = replayDiagnostic('RESPONSE_PENDING', {
      httpStatus: 503,
      admission: 'admitted',
      complete: false,
      resultsAvailable: true,
      receiptRevision: 2,
      headers: { authorization: 'synthetic-private-marker' },
      stack: 'synthetic-private-marker'.repeat(1000),
    });
    expect(JSON.parse(document)).toEqual({
      code: 'RESPONSE_PENDING',
      truncated: true,
      httpStatus: 503,
      admission: 'admitted',
      complete: false,
      resultsAvailable: true,
      receiptRevision: 2,
    });
    expect(document).not.toContain('synthetic-private-marker');
    expect(Buffer.byteLength(document)).toBeLessThanOrEqual(4096);
  });
  it('valores de diagnóstico incompatibles no se convierten ni se archivan como texto', () => {
    expect(
      JSON.parse(
        replayDiagnostic('RESPONSE_INVALID', {
          httpStatus: '200',
          admission: 'secret',
          receiptRevision: -1,
        }),
      ),
    ).toEqual({ code: 'RESPONSE_INVALID', truncated: true });
  });
});
