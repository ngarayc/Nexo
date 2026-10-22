import { readObservedInstant } from '@nexo/contracts';

const formatter = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// Exclusivamente presentación: el orden del dominio conserva el instante exacto.
export function formatTime(value: string | number): string {
  let milliseconds: number;
  if (typeof value === 'number') milliseconds = value;
  else {
    const instant = readObservedInstant(value);
    if (!instant) throw new RangeError('Instante de presentación inválido.');
    // Los motores no interpretan igual las fracciones largas. Truncar únicamente
    // para presentar, sin redondear al segundo siguiente ni alterar el dominio.
    milliseconds =
      Number(instant.epochSecond) * 1000 + Number(instant.fraction.padEnd(3, '0').slice(0, 3));
  }
  const parts = formatter.formatToParts(new Date(milliseconds));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}:${part('second')} (Bogotá)`;
}
