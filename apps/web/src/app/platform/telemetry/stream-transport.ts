import { Injectable, InjectionToken, inject } from '@angular/core';
import type { StreamControl } from '@nexo/contracts';
import type { DomainFrame } from './telemetry-contract';
import { readDomainFrame, readStreamControl } from './telemetry-contract';

export interface StreamHandlers {
  control(value: StreamControl): void;
  frame(value: DomainFrame): void;
  failed(): void;
}
export interface StreamHandle {
  readonly open: boolean;
  close(): void;
}
export interface StreamTransport {
  connect(handlers: StreamHandlers): StreamHandle;
  onResume(handler: () => void): () => void;
}
@Injectable({ providedIn: 'root' })
export class BrowserStreamTransport implements StreamTransport {
  connect(handlers: StreamHandlers): StreamHandle {
    const source = new EventSource('/api/stream');
    const listeners = new Map<string, EventListener>();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      for (const [type, listener] of listeners) source.removeEventListener(type, listener);
      source.close();
    };
    const fail = () => {
      if (!closed) {
        close();
        handlers.failed();
      }
    };
    for (const type of [
      'stream.ready',
      'stream.heartbeat',
      'stream.resync-required',
      'telemetry.accepted',
      'vehicle.updated',
      'alert.created',
    ]) {
      const listener: EventListener = (event) => {
        if (closed) return;
        const message = event as MessageEvent<string>;
        try {
          if (typeof message.data !== 'string') throw new Error('Mensaje inválido.');
          if (type.startsWith('stream.')) handlers.control(readStreamControl(type, message.data));
          else handlers.frame(readDomainFrame(type, message.lastEventId, message.data));
        } catch {
          fail();
        }
      };
      listeners.set(type, listener);
      source.addEventListener(type, listener);
    }
    listeners.set('error', fail);
    source.addEventListener('error', fail);
    return {
      get open() {
        return !closed && source.readyState === EventSource.OPEN;
      },
      close,
    };
  }
  onResume(handler: () => void): () => void {
    const resume = () => {
      if (document.visibilityState === 'visible') handler();
    };
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }
}
export const STREAM_TRANSPORT = new InjectionToken<StreamTransport>('Nexo stream transport', {
  providedIn: 'root',
  factory: () => inject(BrowserStreamTransport),
});
export interface LiveClock {
  now(): number;
  wall(): number;
  random(): number;
  after(milliseconds: number, callback: () => void): () => void;
}
export const LIVE_CLOCK = new InjectionToken<LiveClock>('Nexo live clock', {
  providedIn: 'root',
  factory: () => ({
    now: () => performance.now(),
    wall: () => Date.now(),
    random: () => Math.random(),
    after: (milliseconds, callback) => {
      const timer = setTimeout(callback, milliseconds);
      return () => clearTimeout(timer);
    },
  }),
});
