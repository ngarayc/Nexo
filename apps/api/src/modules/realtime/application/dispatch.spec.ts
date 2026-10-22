import { expect, it, vi } from 'vitest';
import { DispatchOutbox, OutboxReadiness, dispatchLimits, selectGroup } from './dispatch.js';
import type { OutboxStore, PendingMessage, OutboxFailure } from './dispatch.js';

const message = (id: string, bytes = 100): PendingMessage => ({
  messageId: id,
  frameBytes: bytes,
  type: 'telemetry.accepted',
  schemaVersion: 1,
});
function fixture(messages: readonly PendingMessage[] = [message('one')]) {
  const delivered: string[] = [],
    published = new Set<string>();
  const failures = new Map<string, string>();
  const store: OutboxStore = {
    metadata: vi.fn(async () => messages.filter((m) => !published.has(m.messageId))),
    payloads: vi.fn(async (ids: readonly string[]) => new Map(ids.map((id) => [id, id]))),
    publish: vi.fn(async (ids: readonly string[]) => {
      for (const id of ids) {
        published.add(id);
        failures.delete(id);
      }
    }),
    published: vi.fn(
      async (ids: readonly string[]) => new Map(ids.map((id) => [id, published.has(id)])),
    ),
    fail: vi.fn(async (ids: readonly string[], code: OutboxFailure) => {
      for (const id of ids) failures.set(id, code);
    }),
    metrics: vi.fn(async () => ({
      pending: messages.length - published.size,
      failures: failures.size,
      oldestMilliseconds: 0,
    })),
  };
  const readiness = new OutboxReadiness();
  const run = (
    frame: (metadata: PendingMessage, payload: string) => string = (m) => m.messageId,
    distribute: (frame: string) => void = (value) => delivered.push(value),
  ) => new DispatchOutbox(store, frame, distribute, readiness);
  return { store, delivered, published, failures, readiness, run };
}

it('selecciona metadatos antes de cargar: límite exacto, siguiente grupo y trama mayor aislada', async () => {
  const messages = [message('exact', dispatchLimits.bytes), message('next')];
  const f = fixture(messages);
  expect(await f.run().group(new AbortController().signal)).toBe(true);
  expect(f.published).toEqual(new Set(['exact']));
  expect(f.store.payloads).toHaveBeenCalledExactlyOnceWith(['exact']);
  expect(selectGroup([message('large', dispatchLimits.bytes + 1), message('next')])).toEqual([
    message('large', dispatchLimits.bytes + 1),
  ]);
  expect(() => selectGroup([message('invalid', 0)])).toThrow('OUTBOX_METADATA_INVALID');
  expect(() => selectGroup(Array.from({ length: 101 }, () => message('too-many')))).toThrow();
});

it('distribuye antes de marcar y otro grupo no repite los ya publicados', async () => {
  const f = fixture([message('one'), message('two')]);
  const dispatcher = f.run(undefined, (frame) => {
    expect(f.published.size).toBe(0);
    f.delivered.push(frame);
  });
  await dispatcher.group(new AbortController().signal);
  await dispatcher.group(new AbortController().signal);
  expect(f.delivered).toEqual(['one', 'two']);
  expect(f.published).toEqual(new Set(['one', 'two']));
  expect(f.readiness.healthy).toBe(true);
});

it('payload incompatible o publicación fallida no descartan ni bloquean los otros mensajes', async () => {
  const f = fixture([message('bad'), message('failed'), message('good')]);
  await f
    .run(
      (m) => {
        if (m.messageId === 'bad') throw new Error('private-payload-error');
        return m.messageId;
      },
      (frame) => {
        if (frame === 'failed') throw new Error('private-network-error');
        f.delivered.push(frame);
      },
    )
    .group(new AbortController().signal);
  expect(f.published).toEqual(new Set(['good']));
  expect(f.failures).toEqual(
    new Map([
      ['bad', 'OUTBOX_PAYLOAD_INVALID'],
      ['failed', 'OUTBOX_PUBLICATION_FAILED'],
    ]),
  );
  expect(f.readiness.healthy).toBe(false);
});

it('respuesta perdida después de marcado real relee verdad y no repite una publicación confirmada', async () => {
  const f = fixture();
  f.store.publish = vi.fn(async (ids: readonly string[]) => {
    ids.forEach((id) => f.published.add(id));
    throw new Error('commit-reply-lost');
  });
  const dispatcher = f.run();
  await dispatcher.group(new AbortController().signal);
  await dispatcher.group(new AbortController().signal);
  expect(f.delivered).toEqual(['one']);
  expect(f.failures.size).toBe(0);
  expect(f.readiness.healthy).toBe(true);
});

it('marcado no confirmado conserva identidad pendiente y permite repetirla, sin crear otra notificación', async () => {
  const f = fixture();
  const publish = f.store.publish;
  f.store.publish = vi.fn(async () => {
    throw new Error('not-committed');
  });
  const dispatcher = f.run();
  await dispatcher.group(new AbortController().signal);
  expect(f.published.size).toBe(0);
  expect(f.failures.get('one')).toBe('OUTBOX_MARK_UNCONFIRMED');
  expect(f.readiness.healthy).toBe(false);
  f.store.publish = publish;
  await dispatcher.group(new AbortController().signal);
  expect(f.delivered).toEqual(['one', 'one']);
  expect(f.published).toEqual(new Set(['one']));
  expect(f.readiness.healthy).toBe(true);
});

it('estado de marcado ilegible no se interpreta como ausencia ni se registra un reintento ficticio', async () => {
  const f = fixture();
  f.store.publish = vi.fn(async () => {
    throw new Error('unconfirmed');
  });
  f.store.published = vi.fn(async () => {
    throw new Error('unreadable');
  });
  await expect(f.run().group(new AbortController().signal)).rejects.toThrow('unreadable');
  expect(f.failures.size).toBe(0);
  expect(f.readiness.healthy).toBe(false);
});

it('abortar después de distribuir conserva el pendiente para reinicio sin marcarlo ni inventar fallo', async () => {
  const f = fixture();
  const controller = new AbortController();
  const dispatcher = f.run(undefined, (frame) => {
    f.delivered.push(frame);
    controller.abort();
  });
  await expect(dispatcher.group(controller.signal)).rejects.toThrow();
  expect(f.delivered).toEqual(['one']);
  expect(f.published.size).toBe(0);
  expect(f.failures.size).toBe(0);
});

it('salud exige revisión real reciente, sin fallos y sin atrasos aunque siga funcionando un heartbeat', () => {
  let time = 0;
  const health = new OutboxReadiness(() => time);
  expect(health.healthy).toBe(false);
  health.observe({ pending: 1, oldestMilliseconds: 30000, failures: 0 });
  expect(health.healthy).toBe(true);
  time = 10000;
  expect(health.healthy).toBe(false);
  health.observe({ pending: 1, oldestMilliseconds: 30001, failures: 0 });
  expect(health.healthy).toBe(false);
  health.observe({ pending: 1, oldestMilliseconds: 0, failures: 1 });
  expect(health.healthy).toBe(false);
  health.observe({ pending: 0, oldestMilliseconds: 0, failures: 0 });
  expect(health.healthy).toBe(true);
  health.interrupt();
  expect(health.healthy).toBe(false);
});

it('el atraso envejece entre revisiones y los grupos continuos no multiplican el agregado SQL', async () => {
  let time = 0;
  const health = new OutboxReadiness(() => time);
  health.observe({ pending: 1, failures: 0, oldestMilliseconds: 30000 });
  time = 1;
  expect(health.healthy).toBe(false);
  const f = fixture(Array.from({ length: 100 }, (_, index) => message(String(index))));
  f.store.publish = vi.fn(async () => {});
  const dispatcher = new DispatchOutbox(
    f.store,
    (m) => m.messageId,
    () => {},
    health,
  );
  time = 250;
  await dispatcher.group(new AbortController().signal);
  await dispatcher.group(new AbortController().signal);
  expect(f.store.metrics).toHaveBeenCalledOnce();
  time = 500;
  await dispatcher.group(new AbortController().signal);
  expect(f.store.metrics).toHaveBeenCalledTimes(2);
});
