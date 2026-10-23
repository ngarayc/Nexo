import type { ReplayReportDto } from '@nexo/contracts';

const labels: Readonly<Record<string, string>> = {
  'empty-domain': 'Empezar con la demostración vacía',
  'initial-journal': 'Empezar sin reproducciones anteriores',
  'service-ready': 'Disponibilidad del sistema',
  'queue-inventory': 'Comprobar todos los envíos',
  'queue-idle': 'Terminar los envíos pendientes',
  'receipts-idle': 'Terminar de procesar los datos recibidos',
  'first-closed': 'Completar correctamente la primera pasada',
  'same-context': 'Conservar la misma aplicación entre las dos pasadas',
  'original-pair': 'Conservar los resultados de las dos pasadas originales',
  'prior-terminal': 'Terminar la reproducción anterior',
  'scenario-open': 'Estado de la demostración',
  'original-result': 'Disponer del resultado guardado',
};

export function summarizeReplayReport(
  report: Pick<ReplayReportDto, 'result' | 'phase' | 'checks'>,
) {
  const matches = report.checks.filter((item) => item.state === 'matches').length;
  const attention = report.checks
    .filter((item) => item.state !== 'matches')
    .map((item) => ({
      label: labels[item.key] ?? item.label,
      state: item.state,
      explanation:
        item.state === 'differs'
          ? 'El resultado es distinto del esperado.'
          : item.state === 'pending'
            ? 'Esta comprobación sigue pendiente.'
            : 'No se pudo comprobar este punto.',
    }));
  const phase = report.phase === 'first' ? 'Primera pasada' : 'Segunda pasada';
  return {
    matches,
    attention,
    total: report.checks.length,
    title:
      report.result === 'conformant'
        ? report.phase === 'preparation'
          ? 'Todo listo para empezar'
          : phase + ' correcta'
        : report.result === 'non_conformant'
          ? 'Hay resultados por revisar'
          : 'Comprobación incompleta',
    description:
      report.result === 'conformant'
        ? 'Las comprobaciones de este informe coinciden con lo esperado.'
        : report.result === 'non_conformant'
          ? 'Algunos datos no coinciden con lo esperado. Revisa los puntos señalados antes de continuar.'
          : 'No hay información suficiente para confirmar el resultado. Esto no significa que los datos sean incorrectos.',
    expectation:
      report.phase === 'preparation'
        ? 'Para la primera pasada, la demostración debe estar vacía y sin envíos pendientes.'
        : report.phase === 'first'
          ? 'Primera pasada: 20 registros nuevos, 2 duplicados y 2 rechazados por datos inválidos.'
          : 'Segunda pasada: 0 registros nuevos, 22 duplicados y los mismos 2 rechazados. Se conservan los datos de la primera.',
    nextStep:
      report.result === 'conformant'
        ? report.phase === 'preparation'
          ? 'Puedes iniciar la reproducción.'
          : report.phase === 'first'
            ? 'Usa Reiniciar para comprobar los duplicados. No limpies la demostración entre las dos pasadas.'
            : 'Puedes finalizar la verificación para guardar el resultado de las dos pasadas.'
        : report.result === 'non_conformant'
          ? 'Consulta los puntos que requieren atención. Si necesitas empezar desde cero, detén la reproducción y utiliza Limpiar demostración.'
          : 'Recupera el control y comprueba que terminó el procesamiento. Si la reproducción se detuvo antes de tiempo, su informe seguirá incompleto.',
  };
}
