import session from 'express-session';
import createMemoryStore from 'memorystore';
import type { SessionData } from 'express-session';
import './session-data.js';

type Completion = (error?: unknown) => void;
const MemoryStore = createMemoryStore(session);

// Una reserva viva es necesaria para escribir. Un set/touch tardío nunca resucita un SID.
export class BoundedSessionStore extends session.Store {
  private readonly reservations = new Map<string, number>();
  private readonly memory;
  private readonly timer;

  constructor(
    private readonly maximum: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    super();
    this.memory = new MemoryStore({
      max: maximum,
      stale: false,
      checkPeriod: 60000,
      ttl: (_options: unknown, data: SessionData) =>
        Math.max(1, (data.identity?.expiresAt ?? 0) - this.now()),
    });
    this.timer = setInterval(() => this.prune(), 60000);
    this.timer.unref();
  }

  reserve(sid: string, expiresAt: number): boolean {
    this.prune();
    if (expiresAt <= this.now() || this.reservations.size >= this.maximum) return false;
    this.reservations.set(sid, expiresAt);
    return true;
  }

  isActive(sid: string): boolean {
    const expiresAt = this.reservations.get(sid);
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.now()) {
      this.destroy(sid);
      return false;
    }
    return true;
  }

  override get(sid: string, done: (error: unknown, data?: SessionData | null) => void): void {
    if (!this.isActive(sid)) return done(null, null);
    this.memory.get(sid, (error, data) => {
      if (error) return done(error);
      if (
        !this.isActive(sid) ||
        !data?.identity ||
        data.identity.expiresAt !== this.reservations.get(sid)
      ) {
        this.destroy(sid);
        return done(null, null);
      }
      done(null, data);
    });
  }

  override set(sid: string, data: SessionData, done?: Completion): void {
    if (!this.isActive(sid) || data.identity?.expiresAt !== this.reservations.get(sid)) {
      done?.(new Error('Sesión revocada o vencida.'));
      return;
    }
    this.memory.set(sid, data, done);
  }

  override destroy(sid: string, done?: Completion): void {
    const existed = this.reservations.delete(sid);
    if (existed) this.emit('revoked', sid);
    this.memory.destroy(sid, done);
  }

  override touch(_sid: string, _data: SessionData, done?: Completion): void {
    done?.(); // Ninguna actividad renueva el plazo absoluto ni escribe estado obsoleto.
  }

  private prune(): void {
    for (const sid of this.reservations.keys()) this.isActive(sid);
  }

  close(): void {
    clearInterval(this.timer);
    this.memory.stopInterval();
    for (const sid of this.reservations.keys()) this.destroy(sid);
  }
}
