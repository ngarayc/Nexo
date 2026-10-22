import { readObservedInstant } from '@nexo/contracts';
import type { EventView } from '@nexo/contracts';

export interface SpeedSample {
  readonly x: number;
  readonly y: number;
  readonly event: EventView;
}
export interface SpeedSeries {
  readonly samples: readonly SpeedSample[];
  readonly startMilliseconds: number;
  readonly maxX: number;
  readonly maxY: number;
}

// Estos números solo sirven para dibujar. Instante, orden y selección siguen
// usando las observaciones originales de la fachada, incluso si un píxel coincide.
export function speedSeries(events: readonly EventView[]): SpeedSeries {
  if (!events.length)
    return Object.freeze({ samples: Object.freeze([]), startMilliseconds: 0, maxX: 1, maxY: 80 });
  const first = readObservedInstant(events[0]!.observedAt);
  if (!first) throw new RangeError('Instante gráfico inválido.');
  const fraction = (value: string) => Number('0.' + (value || '0'));
  const baseFraction = fraction(first.fraction);
  const samples = events.map((event) => {
    const instant = readObservedInstant(event.observedAt);
    if (!instant) throw new RangeError('Instante gráfico inválido.');
    return Object.freeze({
      event,
      x:
        Number(instant.epochSecond - first.epochSecond) * 1000 +
        (fraction(instant.fraction) - baseFraction) * 1000,
      y: event.speedKph,
    });
  });
  return Object.freeze({
    samples: Object.freeze(samples),
    startMilliseconds:
      Number(first.epochSecond) * 1000 + Number(first.fraction.padEnd(3, '0').slice(0, 3)),
    maxX: Math.max(1, samples.at(-1)!.x),
    maxY: samples.reduce((maximum, sample) => Math.max(maximum, sample.y), 80),
  });
}
