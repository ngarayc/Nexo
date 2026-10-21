import { inject, Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { SessionApi } from './data-access/session-api';
import { SessionState } from '../../platform/session/session-state';

@Injectable({ providedIn: 'root' })
export class AccessFacade {
  private readonly api = inject(SessionApi);
  private readonly state = inject(SessionState);
  private readonly router = inject(Router);
  readonly session = this.state.session;
  readonly notice = this.state.notice;
  readonly pending = signal(false);
  readonly error = signal('');
  private restoring: Promise<boolean> | undefined;

  ensure(): Promise<boolean> {
    if (this.session() && Date.parse(this.session()!.expiresAt) > Date.now())
      return Promise.resolve(true);
    if (this.restoring) return this.restoring;
    const epoch = this.state.epoch;
    this.restoring = this.api
      .current()
      .then((snapshot) => this.state.accept(snapshot, epoch))
      .catch(() => false)
      .finally(() => {
        this.restoring = undefined;
      });
    return this.restoring;
  }

  async login(username: string, password: string): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    this.state.clear();
    const epoch = this.state.epoch;
    try {
      const snapshot = await this.api.login(username, password);
      if (this.state.accept(snapshot, epoch)) await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.pending.set(false);
    }
  }

  async logout(): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    try {
      await this.api.logout();
      this.state.clear();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.pending.set(false);
    }
  }

  private message(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 403)
        return 'Usuario o contraseña incorrectos, o sesión vencida. Vuelve a intentarlo.';
      if (error.status === 429) {
        const seconds = Number(error.headers.get('Retry-After'));
        return Number.isInteger(seconds) && seconds > 0 && seconds <= 60
          ? `Demasiados intentos. Espera ${seconds} segundos antes de volver a intentarlo.`
          : 'Demasiados intentos. Espera un minuto antes de volver a intentarlo.';
      }
      if (error.status === 400 || error.status === 413) return 'Revisa el usuario y la contraseña.';
    }
    return 'No fue posible contactar con el servicio. Inténtalo de nuevo.';
  }
}
