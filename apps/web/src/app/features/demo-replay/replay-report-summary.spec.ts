import { expect, it } from 'vitest';
import type { ReplayReportDto } from '@nexo/contracts';
import { summarizeReplayReport } from './replay-report-summary';

const report = (result: ReplayReportDto['result'], phase: ReplayReportDto['phase'] = 'first') =>
  ({
    result,
    phase,
    checks: [
      {
        key: 'queue-idle',
        label: 'Cola',
        state: 'matches',
        source: 'fuente',
        expected: 0,
        observed: 0,
      },
      {
        key: 'empty-domain',
        label: 'Snapshot SQL',
        state: 'unavailable',
        source: 'fuente',
        expected: 0,
        observed: null,
      },
    ],
  }) satisfies Pick<ReplayReportDto, 'result' | 'phase' | 'checks'>;

it('explica el resultado esperado sin confundir duplicados o rechazos con un fallo', () => {
  const first = summarizeReplayReport(report('conformant'));
  expect(first.title).toBe('Primera pasada correcta');
  expect(first.expectation).toContain('20 registros nuevos, 2 duplicados y 2 rechazados');
  expect(first.nextStep).toContain('No limpies');
  const second = summarizeReplayReport(report('conformant', 'second'));
  expect(second.expectation).toContain('0 registros nuevos, 22 duplicados');
  expect(second.nextStep).toContain('finalizar');
});
it('un resultado incompleto no se presenta como error de datos ni como conformidad', () => {
  const summary = summarizeReplayReport(report('inconclusive'));
  expect(summary.title).toBe('Comprobación incompleta');
  expect(summary.description).toContain('no significa que los datos sean incorrectos');
  expect(summary.matches).toBe(1);
  expect(summary.attention).toEqual([
    {
      label: 'Empezar con la demostración vacía',
      state: 'unavailable',
      explanation: 'No se pudo comprobar este punto.',
    },
  ]);
  expect(summarizeReplayReport(report('non_conformant')).title).toBe('Hay resultados por revisar');
});
