import { expect, it, vi } from 'vitest';
import { OutboxReadiness } from './dispatch.js';
import { RealtimeAvailability } from './availability.js';

it('degradación cierra una vez y recuperación comprobada renueva la instancia antes de otro ready', () => {
  const readiness = new OutboxReadiness();
  const renew = vi.fn(),
    close = vi.fn();
  const availability = new RealtimeAvailability(readiness, renew);
  availability.onDegraded(close);
  expect(availability.healthy).toBe(false);
  readiness.observe({ pending: 0, failures: 0, oldestMilliseconds: 0 });
  expect(availability.healthy).toBe(true);
  expect(renew).not.toHaveBeenCalled();
  readiness.interrupt();
  expect(availability.healthy).toBe(false);
  expect(availability.healthy).toBe(false);
  expect(close).toHaveBeenCalledOnce();
  readiness.observe({ pending: 0, failures: 0, oldestMilliseconds: 0 });
  expect(availability.healthy).toBe(true);
  expect(renew).toHaveBeenCalledOnce();
});
it('heartbeat no rehabilita una revisión estancada y retirar suscripción libera su callback', () => {
  let clock = 0;
  const readiness = new OutboxReadiness(() => clock);
  const close = vi.fn();
  const availability = new RealtimeAvailability(readiness, () => {});
  const remove = availability.onDegraded(close);
  readiness.observe({ pending: 0, failures: 0, oldestMilliseconds: 0 });
  expect(availability.healthy).toBe(true);
  clock = 10000;
  expect(availability.healthy).toBe(false);
  expect(close).toHaveBeenCalledOnce();
  remove();
  readiness.observe({ pending: 0, failures: 0, oldestMilliseconds: 0 });
  expect(availability.healthy).toBe(true);
  readiness.interrupt();
  expect(availability.healthy).toBe(false);
  expect(close).toHaveBeenCalledOnce();
});
