import { Temporal } from '@js-temporal/polyfill';

export interface ObservedInstant {
  readonly original: string;
  readonly epochSecond: bigint;
  readonly fraction: string;
}

const nanosecondsPerSecond = 1_000_000_000n;

export function readObservedInstant(value: unknown): ObservedInstant | undefined {
  if (typeof value !== 'string') return;
  // Temporal valida calendario/zona a nanosegundos. La cola decimal se conserva
  // aparte: no participa en la conversión ni se redondea para comparar.
  const match = /[Tt ]\d{2}:?\d{2}:?\d{2}[.,](\d+)/.exec(value);
  const digits = match?.[1] ?? '';
  const tail = digits.slice(9);
  let input = value;
  if (tail && match) {
    const end = match.index + match[0].length;
    input = value.slice(0, end - digits.length) + digits.slice(0, 9) + value.slice(end);
  }
  try {
    const nanoseconds = Temporal.Instant.from(input).epochNanoseconds;
    let epochSecond = nanoseconds / nanosecondsPerSecond;
    let remainder = nanoseconds % nanosecondsPerSecond;
    if (remainder < 0n) {
      epochSecond -= 1n;
      remainder += nanosecondsPerSecond;
    }
    const fraction = (remainder.toString().padStart(9, '0') + tail).replace(/0+$/, '');
    return Object.freeze({ original: value, epochSecond, fraction });
  } catch (error) {
    if (error instanceof RangeError) return;
    throw error;
  }
}

export function compareObservedInstant(
  first: Pick<ObservedInstant, 'epochSecond' | 'fraction'>,
  second: Pick<ObservedInstant, 'epochSecond' | 'fraction'>,
): -1 | 0 | 1 {
  if (first.epochSecond !== second.epochSecond)
    return first.epochSecond < second.epochSecond ? -1 : 1;
  if (first.fraction === second.fraction) return 0;
  return first.fraction < second.fraction ? -1 : 1;
}

export function observedInstantUtc(
  value: Pick<ObservedInstant, 'epochSecond' | 'fraction'>,
): string {
  const start = Temporal.Instant.fromEpochNanoseconds(
    value.epochSecond * nanosecondsPerSecond,
  ).toString({ smallestUnit: 'second' });
  return value.fraction ? `${start.slice(0, -1)}.${value.fraction}Z` : start;
}
