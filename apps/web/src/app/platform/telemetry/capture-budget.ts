import type { DomainChange } from '@nexo/contracts';
import { CaptureCapacityError, captureLimits } from './telemetry-contract';
import type { DomainFrame } from './telemetry-contract';

export class ObsoleteCapture extends Error {
  constructor() {
    super('La captura ya no pertenece a la sincronización activa.');
  }
}
export interface CaptureHandle {
  readonly active: boolean;
  take(): readonly DomainChange[];
  cancel(): void;
}
interface Capture {
  readonly token: symbol;
  readonly accepts: (change: DomainChange) => boolean;
  readonly frames: Set<string>;
  active: boolean;
}
interface Entry {
  readonly frame: DomainFrame;
  readonly owners: Set<symbol>;
}

// Una trama se conserva por referencia mientras alguna captura la necesite.
// Snapshot e historial comparten el mismo presupuesto, incluso si se solapan.
export class CaptureBudget {
  private readonly captures = new Map<symbol, Capture>();
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;

  get retainedMessages(): number {
    return this.entries.size;
  }
  get retainedBytes(): number {
    return this.bytes;
  }

  begin(accepts: (change: DomainChange) => boolean = () => true): CaptureHandle {
    const capture: Capture = { token: Symbol(), accepts, frames: new Set(), active: true };
    this.captures.set(capture.token, capture);
    return {
      get active() {
        return capture.active;
      },
      take: () => {
        if (!capture.active) throw new ObsoleteCapture();
        const frames = [...capture.frames].map((id) => this.entries.get(id)!.frame.change);
        this.release(capture);
        return Object.freeze(frames);
      },
      cancel: () => this.release(capture),
    };
  }

  push(frame: DomainFrame): void {
    const owners = [...this.captures.values()].filter((capture) => capture.accepts(frame.change));
    if (!owners.length) return;
    const id = frame.change.messageId;
    let entry = this.entries.get(id);
    if (!entry) {
      if (
        !Number.isSafeInteger(frame.bytes) ||
        frame.bytes <= 0 ||
        this.entries.size + 1 > captureLimits.messages ||
        this.bytes + frame.bytes > captureLimits.bytes
      ) {
        this.clear();
        throw new CaptureCapacityError();
      }
      entry = { frame, owners: new Set() };
      this.entries.set(id, entry);
      this.bytes += frame.bytes;
    }
    for (const capture of owners) {
      capture.frames.add(id);
      entry.owners.add(capture.token);
    }
  }

  clear(): void {
    for (const capture of this.captures.values()) {
      capture.active = false;
      capture.frames.clear();
    }
    this.captures.clear();
    this.entries.clear();
    this.bytes = 0;
  }
  private release(capture: Capture): void {
    if (!capture.active) return;
    capture.active = false;
    this.captures.delete(capture.token);
    for (const id of capture.frames) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      entry.owners.delete(capture.token);
      if (!entry.owners.size) {
        this.entries.delete(id);
        this.bytes -= entry.frame.bytes;
      }
    }
    capture.frames.clear();
  }
}
