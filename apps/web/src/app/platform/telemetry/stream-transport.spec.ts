import { afterEach, expect, it, vi } from 'vitest';
import { BrowserStreamTransport } from './stream-transport';

class Source extends EventTarget {
  static readonly OPEN = 1;
  static instances: Source[] = [];
  readyState = 1;
  closes = 0;
  constructor(readonly url: string) {
    super();
    Source.instances.push(this);
  }
  close() {
    this.closes++;
    this.readyState = 2;
  }
  message(type: string, value: unknown, lastEventId = '') {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value), lastEventId }));
  }
}
const instanceId = '00000000-0000-4000-8000-000000000001';
afterEach(() => {
  vi.unstubAllGlobals();
  Source.instances = [];
});
it('cierra EventSource y retira listeners antes de delegar el error al único dueño de retries', () => {
  vi.stubGlobal('EventSource', Source);
  const control = vi.fn(),
    frame = vi.fn();
  const failed = vi.fn(() => expect(Source.instances[0]!.closes).toBe(1));
  const handle = new BrowserStreamTransport().connect({ control, frame, failed });
  const source = Source.instances[0]!;
  const remove = vi.spyOn(source, 'removeEventListener');
  expect(source.url).toBe('/api/stream');
  expect(handle.open).toBe(true);
  source.dispatchEvent(new Event('error'));
  source.dispatchEvent(new Event('error'));
  source.message('stream.heartbeat', { type: 'stream.heartbeat', schemaVersion: 1, instanceId });
  handle.close();
  expect(handle.open).toBe(false);
  expect(failed).toHaveBeenCalledTimes(1);
  expect(control).not.toHaveBeenCalled();
  expect(frame).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(7);
  expect(source.closes).toBe(1);
});
it('los controles no usan el Last-Event-ID heredado y un mensaje inválido cierra el transporte', () => {
  vi.stubGlobal('EventSource', Source);
  const control = vi.fn(),
    failed = vi.fn();
  new BrowserStreamTransport().connect({ control, frame: vi.fn(), failed });
  const source = Source.instances[0]!;
  source.message(
    'stream.ready',
    { type: 'stream.ready', schemaVersion: 1, instanceId, heartbeatMilliseconds: 15000 },
    'uuid-de-un-mensaje-anterior',
  );
  expect(control).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
  source.message('vehicle.updated', {});
  expect(failed).toHaveBeenCalledTimes(1);
  expect(source.closes).toBe(1);
});
it('los listeners de regreso se retiran juntos al cambiar de ámbito', () => {
  const resume = vi.fn();
  const clean = new BrowserStreamTransport().onResume(resume);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new Event('pageshow'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(resume).toHaveBeenCalledTimes(3);
  clean();
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(resume).toHaveBeenCalledTimes(3);
});
