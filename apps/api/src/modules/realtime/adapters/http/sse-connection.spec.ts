import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SseConnection, connectionLimits } from './sse-connection.js';

class Output extends EventEmitter {
  readonly frames: string[] = [];
  readonly completions: ((error?: Error | null) => void)[] = [];
  writableLength = 0;
  destroyed = false;
  writableEnded = false;
  writable = false;
  write(frame: string, complete: (error?: Error | null) => void): boolean {
    this.frames.push(frame);
    this.writableLength += Buffer.byteLength(frame);
    this.completions.push(complete);
    return this.writable;
  }
  destroy(): void {
    this.destroyed = true;
    this.writableLength = 0;
  }
  progress(): void {
    this.writableLength = 0;
    for (const done of this.completions.splice(0)) done();
    this.emit('drain');
  }
}
function connect(authorized = () => true) {
  const output = new Output();
  const released = vi.fn();
  const connection = new SseConnection(output, authorized, released);
  connection.start(Date.now() + 14400000);
  return { output, connection, released };
}
afterEach(() => vi.useRealTimers());

it('write false conserva una sola transferencia y las siguientes esperan drain', () => {
  const { connection, output, released } = connect();
  connection.enqueue('first');
  connection.enqueue('second');
  expect(output.frames).toEqual(['first']);
  output.progress();
  expect(output.frames).toEqual(['first', 'second']);
  output.progress();
  connection.close();
  expect(released).toHaveBeenCalledOnce();
  expect(output.listenerCount('drain')).toBe(0);
});

it('bytes UTF-8 incluyen la escritura transferida y cola, sin contar dos veces la trama', () => {
  const { connection, output, released } = connect();
  const first = 'ñ'.repeat(connectionLimits.bytes / 2 - 1);
  expect(connection.enqueue(first)).toBe(true);
  expect(connection.enqueue('ñ')).toBe(true);
  expect(output.frames).toEqual([first]);
  expect(connection.enqueue('x')).toBe(false);
  expect(output.destroyed).toBe(true);
  expect(released).toHaveBeenCalledOnce();
});

it('la escritura pendiente cuenta entre los mil mensajes y el siguiente cierra solo esa conexión', () => {
  const slow = connect(),
    healthy = connect();
  healthy.output.writable = true;
  for (let index = 0; index < 1000; index++) expect(slow.connection.enqueue('x')).toBe(true);
  expect(slow.connection.enqueue('x')).toBe(false);
  expect(slow.output.frames.length).toBe(1);
  expect(healthy.connection.enqueue('live')).toBe(true);
  expect(healthy.output.frames).toEqual(['live']);
  healthy.connection.close();
});

it('sin progreso durante quince segundos libera una vez aun con heartbeats encolados', () => {
  vi.useFakeTimers();
  const { connection, output, released } = connect();
  connection.enqueue('first');
  vi.advanceTimersByTime(14000);
  connection.enqueue('heartbeat');
  vi.advanceTimersByTime(1000);
  expect(output.destroyed).toBe(true);
  output.emit('close');
  connection.close();
  expect(released).toHaveBeenCalledOnce();
});

it('progreso real reinicia la espera y callbacks tardíos no reviven una conexión cerrada', () => {
  vi.useFakeTimers();
  const { connection, output, released } = connect();
  connection.enqueue('first');
  vi.advanceTimersByTime(14000);
  output.progress();
  connection.enqueue('second');
  vi.advanceTimersByTime(14000);
  expect(output.destroyed).toBe(false);
  const callback = output.completions[0]!;
  connection.close();
  callback();
  output.emit('drain');
  expect(connection.enqueue('late')).toBe(false);
  expect(released).toHaveBeenCalledOnce();
});

it('revocación se comprueba antes de cada escritura y el vencimiento cierra aunque no haya tráfico', () => {
  vi.useFakeTimers();
  let allowed = true;
  const f = connect(() => allowed);
  f.connection.enqueue('first');
  f.connection.enqueue('queued');
  allowed = false;
  f.output.progress();
  expect(f.output.frames).toEqual(['first']);
  expect(f.released).toHaveBeenCalledOnce();
  const quiet = connect();
  vi.advanceTimersByTime(14400000);
  expect(quiet.connection.isClosed).toBe(true);
  expect(quiet.released).toHaveBeenCalledOnce();
});

it('fallo de escritura y salida ya destruida cierran sin dejar listeners o cupo', () => {
  const f = connect();
  f.output.write = () => {
    throw new Error('private-write-error');
  };
  expect(f.connection.enqueue('frame')).toBe(false);
  expect(f.released).toHaveBeenCalledOnce();
  const other = connect();
  other.output.destroyed = true;
  expect(other.connection.enqueue('frame')).toBe(false);
  expect(other.released).toHaveBeenCalledOnce();
});

it('error emitido después del callback fallido se absorbe hasta close y libera los listeners finales', () => {
  const f = connect();
  f.connection.enqueue('frame');
  f.output.completions[0]!(new Error('write-failed'));
  expect(() => f.output.emit('error', new Error('transport-failed'))).not.toThrow();
  f.output.emit('close');
  expect(f.released).toHaveBeenCalledOnce();
  expect(f.output.listenerCount('error')).toBe(0);
  expect(f.output.listenerCount('close')).toBe(0);
});

it('una trama demasiado grande sin datos retenidos permite intentar resync y después cerrar', () => {
  const output = new Output(),
    released = vi.fn();
  const connection = new SseConnection(
    output,
    () => true,
    released,
    () => Date.now(),
    () => 'event:stream.resync-required\ndata:{}\n\n',
  );
  connection.start(Date.now() + 10000);
  expect(connection.enqueue('x'.repeat(connectionLimits.bytes + 1))).toBe(false);
  expect(output.frames).toEqual(['event:stream.resync-required\ndata:{}\n\n']);
  expect(connection.isClosed).toBe(true);
  expect(released).toHaveBeenCalledOnce();
});
