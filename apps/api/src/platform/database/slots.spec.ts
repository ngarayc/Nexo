import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseCapacityError, DatabaseSlots } from './slots.js';

describe('acceso SQL acotado sin cola ilimitada', () => {
  afterEach(() => vi.useRealTimers());

  it('respeta capacidad, orden de espera y libera tras una excepción', async () => {
    const slots = new DatabaseSlots(1, 1);
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const order: string[] = [];
    const first = slots.run(async () => {
      order.push('first');
      await held;
      throw new Error('EXPECTED');
    });
    const failed = expect(first).rejects.toThrow('EXPECTED');
    const second = slots.run(async () => {
      order.push('second');
      return 2;
    });
    await expect(slots.run(async () => 3)).rejects.toThrow(DatabaseCapacityError);
    expect(order).toEqual(['first']);
    finish();
    await failed;
    expect(await second).toBe(2);
    expect(order).toEqual(['first', 'second']);
    expect(await slots.run(async () => 4)).toBe(4);
  });

  it('vence una espera sin ejecutar después su operación ni consumir otro turno', async () => {
    vi.useFakeTimers();
    const slots = new DatabaseSlots(1, 1, 2000);
    let finish!: () => void;
    const first = slots.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    const operation = vi.fn(async () => true);
    const waiting = slots.run(operation);
    const expired = expect(waiting).rejects.toThrow(DatabaseCapacityError);
    await vi.advanceTimersByTimeAsync(2000);
    await expired;
    finish();
    await first;
    expect(operation).not.toHaveBeenCalled();
    expect(await slots.run(async () => 'available')).toBe('available');
    expect(vi.getTimerCount()).toBe(0);
  });
});
