import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayEmitter } from './replay-emitter.js';
import type { ReplayDispatch, ReplayEmissionJournal } from './replay-emitter.js';
import type { ReplayDelivery, SendReplayLine } from './send-replay-line.js';

const ticket: ReplayDispatch = {
  line: { body: '{"events":[]}', eventId: 'synthetic-event' },
  ingestionId: '9efdc9d3-9535-40da-9ed3-1be6d3c510c8',
};
const accepted: ReplayDelivery = { state: 'classified', outcome: 'accepted', reasonCode: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function setup() {
  const journal = {
    claim: vi.fn<ReplayEmissionJournal['claim']>().mockResolvedValue(ticket),
    settle: vi.fn<ReplayEmissionJournal['settle']>().mockResolvedValue(750),
    blocked: vi.fn<ReplayEmissionJournal['blocked']>(),
  };
  const producer = { send: vi.fn<SendReplayLine['send']>().mockResolvedValue(accepted) };
  const emitter = new ReplayEmitter(journal, producer);
  return { emitter, journal, producer };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('emisor progresivo independiente del receptor', () => {
  it('no envía al construirse y espera el intervalo completo después del diario confirmado', async () => {
    const { emitter, journal, producer } = setup();
    const commit = deferred<number | null>();
    journal.settle.mockReturnValueOnce(commit.promise);
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).not.toHaveBeenCalled();
    emitter.arm(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(producer.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).toHaveBeenCalledTimes(1);
    commit.resolve(750);
    await emitter.whenIdle();
    await vi.advanceTimersByTimeAsync(749);
    expect(producer.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(producer.send).toHaveBeenCalledTimes(2);
    emitter.close();
  });
  it('pausar no aborta la petición vigente y reanudar espera su intervalo sin compensar retrasos', async () => {
    const { emitter, journal, producer } = setup();
    const response = deferred<ReplayDelivery>();
    producer.send.mockReturnValueOnce(response.promise);
    emitter.arm(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(emitter.inFlight).toBe(true);
    const signal = producer.send.mock.calls[0]![2];
    emitter.inhibit();
    await vi.advanceTimersByTimeAsync(10000);
    expect(signal.aborted).toBe(false);
    expect(producer.send).toHaveBeenCalledTimes(1);
    response.resolve(accepted);
    await emitter.whenIdle();
    expect(journal.settle).toHaveBeenCalledWith(ticket, accepted);
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).toHaveBeenCalledTimes(1);
    emitter.arm(1500);
    await vi.advanceTimersByTimeAsync(1499);
    expect(producer.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(producer.send).toHaveBeenCalledTimes(2);
    emitter.close();
  });
  it('solo un claim y una petición pueden permanecer pendientes aunque se arme de nuevo', async () => {
    const { emitter, journal, producer } = setup();
    const claim = deferred<ReplayDispatch | null>();
    journal.claim.mockReturnValueOnce(claim.promise);
    emitter.arm(0);
    await vi.advanceTimersByTimeAsync(0);
    emitter.arm(100);
    await vi.advanceTimersByTimeAsync(5000);
    expect(journal.claim).toHaveBeenCalledTimes(1);
    expect(producer.send).not.toHaveBeenCalled();
    claim.resolve(ticket);
    await emitter.whenIdle();
    expect(producer.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(producer.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(producer.send).toHaveBeenCalledTimes(2);
    emitter.close();
  });
  it('una pausa durante claim deja resolver el envío ya autorizado sin habilitar otro', async () => {
    const { emitter, journal, producer } = setup();
    const claim = deferred<ReplayDispatch | null>();
    journal.claim.mockReturnValueOnce(claim.promise);
    emitter.arm(0);
    await vi.advanceTimersByTimeAsync(0);
    emitter.inhibit();
    claim.resolve(ticket);
    await emitter.whenIdle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).toHaveBeenCalledTimes(1);
    emitter.close();
  });
  it.each(['claim', 'settle'] as const)(
    'un fallo en %s bloquea sin reintentos ni otro envío',
    async (operation) => {
      const { emitter, journal, producer } = setup();
      journal[operation].mockRejectedValueOnce(new Error('synthetic-journal-loss'));
      emitter.arm(0);
      await vi.advanceTimersByTimeAsync(10000);
      expect(journal.blocked).toHaveBeenCalledTimes(1);
      expect(journal.claim).toHaveBeenCalledTimes(1);
      expect(producer.send).toHaveBeenCalledTimes(operation === 'claim' ? 0 : 1);
      emitter.close();
    },
  );
  it('un transporte que lanza conserva incertidumbre y no inventa rechazo', async () => {
    const { emitter, journal, producer } = setup();
    producer.send.mockRejectedValueOnce(new Error('synthetic-private-marker'));
    journal.settle.mockResolvedValueOnce(null);
    emitter.arm(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).toHaveBeenCalledTimes(1);
    const delivery = journal.settle.mock.calls[0]![1];
    expect(delivery.state).toBe('uncertain');
    expect(JSON.stringify(delivery)).not.toContain('synthetic-private-marker');
    emitter.close();
  });
  it('sin ticket no envía y un cierre permanente aborta solo su transporte', async () => {
    const { emitter, journal, producer } = setup();
    journal.claim.mockResolvedValueOnce(null);
    emitter.arm(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).not.toHaveBeenCalled();
    const response = deferred<ReplayDelivery>();
    producer.send.mockReturnValueOnce(response.promise);
    emitter.arm(0);
    await vi.advanceTimersByTimeAsync(0);
    const signal = producer.send.mock.calls[0]![2];
    emitter.close();
    expect(signal.aborted).toBe(true);
    emitter.arm(100);
    response.resolve(accepted);
    await emitter.whenIdle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });
});
