import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { SessionSnapshot } from './session-contract';

@Injectable({ providedIn: 'root' })
export class SessionState implements OnDestroy {
  private readonly router = inject(Router);
  private readonly value = signal<SessionSnapshot | null>(null);
  readonly session = this.value.asReadonly();
  readonly notice = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;

  get epoch(): number {
    return this.revision;
  }

  accept(snapshot: SessionSnapshot, epoch: number): boolean {
    if (epoch !== this.revision || Date.parse(snapshot.expiresAt) <= Date.now()) return false;
    const previous = this.value();
    if (
      previous &&
      (previous.csrfToken !== snapshot.csrfToken || previous.user.id !== snapshot.user.id)
    ) {
      // Otro login puede regenerar la cookie HttpOnly desde una pestaña del
      // mismo navegador. El token sincronizado identifica un ámbito nuevo sin
      // leer el SID y evita conservar datos/callbacks de la sesión anterior.
      this.revision += 1;
    }
    clearTimeout(this.timer);
    this.value.set(snapshot);
    this.notice.set('');
    this.timer = setTimeout(() => this.expire(), Date.parse(snapshot.expiresAt) - Date.now());
    return true;
  }

  clear(): void {
    this.revision += 1;
    clearTimeout(this.timer);
    this.value.set(null);
  }

  expire(): void {
    const wasAuthenticated = this.value() !== null;
    this.clear();
    this.notice.set('Tu sesión venció. Inicia sesión de nuevo.');
    if (wasAuthenticated) void this.router.navigateByUrl('/login');
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
