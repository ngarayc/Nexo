export const connectionLimits = Object.freeze({
  messages: 1000,
  bytes: 2 * 1024 * 1024,
  drain: 15000,
});
export interface SseOutput {
  readonly writableLength: number;
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  write(frame: string, complete: (error?: Error | null) => void): boolean;
  destroy(): void;
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

export class SseConnection {
  private readonly queue: { frame: string; bytes: number }[] = [];
  private queuedBytes = 0;
  private pendingFrames = 0;
  private waiting = false;
  private pumping = false;
  private started = false;
  private closed = false;
  private progressTimer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly output: SseOutput,
    private readonly authorized: () => boolean,
    private readonly released: () => void,
    private readonly now: () => number = () => Date.now(),
    private readonly resyncFrame?: () => string,
  ) {
    output.on('close', this.outputClosed);
    output.on('error', this.close);
    output.on('drain', this.drain);
  }

  // El dueño registra la conexión antes de activarla; el cierre puede ser inmediato.
  start(expiresAt: number): void {
    if (this.started || this.closed) return;
    this.started = true;
    if (expiresAt <= this.now() || !this.allowed()) return this.close();
    this.expiryTimer = setTimeout(this.close, Math.max(1, expiresAt - this.now()));
    this.expiryTimer.unref();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  enqueue(frame: string): boolean {
    if (!this.started || this.closed) return false;
    if (!this.allowed()) {
      this.close();
      return false;
    }
    const bytes = Buffer.byteLength(frame);
    if (
      this.pendingFrames + 1 > connectionLimits.messages ||
      this.queuedBytes + this.output.writableLength + bytes > connectionLimits.bytes
    ) {
      // La recuperación no depende de recibir un control en una conexión saturada.
      this.resynchronize();
      return false;
    }
    this.queue.push({ frame, bytes });
    this.queuedBytes += bytes;
    this.pendingFrames++;
    this.pump();
    this.watchProgress();
    return !this.closed;
  }

  readonly close = (): void => {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.progressTimer);
    clearTimeout(this.expiryTimer);
    // Node puede emitir error después del callback de escritura. Mantener su
    // manejador hasta close evita un error sin listener durante el desmontaje.
    this.output.off('drain', this.drain);
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.pendingFrames = 0;
    try {
      this.output.destroy();
    } finally {
      this.released();
    }
  };

  resynchronize(): void {
    if (this.closed) return;
    if (this.resyncFrame && !this.waiting && this.pendingFrames === 0 && this.allowed()) {
      try {
        const frame = this.resyncFrame();
        if (this.output.writableLength + Buffer.byteLength(frame) <= connectionLimits.bytes)
          this.output.write(frame, () => {});
      } catch {
        /* La corrección no depende de que el control llegue. */
      }
    }
    this.close();
  }

  private readonly outputClosed = (): void => {
    this.close();
    this.output.off('close', this.outputClosed);
    this.output.off('error', this.close);
  };

  private allowed(): boolean {
    if (this.output.destroyed || this.output.writableEnded) return false;
    try {
      return this.authorized();
    } catch {
      return false;
    }
  }
  private readonly drain = (): void => {
    if (this.closed) return;
    this.waiting = false;
    this.progress();
    this.pump();
  };
  private progress(): void {
    clearTimeout(this.progressTimer);
    this.progressTimer = undefined;
    this.watchProgress();
  }
  private watchProgress(): void {
    if (this.closed || this.progressTimer || this.pendingFrames === 0) return;
    this.progressTimer = setTimeout(() => this.resynchronize(), connectionLimits.drain);
    this.progressTimer.unref();
  }
  private pump(): void {
    if (this.pumping || this.closed || this.waiting) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.waiting && !this.closed) {
        if (!this.allowed()) {
          this.close();
          break;
        }
        const item = this.queue.shift()!;
        this.queuedBytes -= item.bytes;
        const writable = this.output.write(item.frame, (error) => {
          if (this.closed) return;
          this.pendingFrames--;
          if (error) this.close();
          else {
            this.progress();
            this.pump();
          }
        });
        if (this.closed) break;
        // write=false ya transfirió la trama. Solo las siguientes esperan drain.
        if (!writable) this.waiting = true;
        this.watchProgress();
      }
    } catch {
      this.close();
    } finally {
      this.pumping = false;
    }
  }
}
