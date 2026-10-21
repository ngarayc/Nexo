import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import type { SessionSnapshot } from '../../../platform/session/session-contract';

function readSnapshot(value: unknown): SessionSnapshot {
  if (typeof value !== 'object' || value === null) throw new Error('Respuesta de acceso inválida.');
  const data = value as Record<string, unknown>;
  const user = data['user'];
  if (
    typeof user !== 'object' ||
    user === null ||
    !('id' in user) ||
    typeof user.id !== 'string' ||
    !('username' in user) ||
    user.username !== 'demo' ||
    typeof data['expiresAt'] !== 'string' ||
    !Number.isFinite(Date.parse(data['expiresAt'])) ||
    typeof data['csrfToken'] !== 'string' ||
    !/^[a-f0-9]{256}$/.test(data['csrfToken'])
  )
    throw new Error('Respuesta de acceso inválida.');
  return {
    user: { id: user.id, username: 'demo' },
    expiresAt: data['expiresAt'],
    csrfToken: data['csrfToken'],
  };
}

@Injectable({ providedIn: 'root' })
export class SessionApi {
  private readonly http = inject(HttpClient);

  async current(): Promise<SessionSnapshot> {
    return readSnapshot(
      await firstValueFrom(this.http.get<unknown>('/api/session').pipe(timeout(15000))),
    );
  }

  async login(username: string, password: string): Promise<SessionSnapshot> {
    return readSnapshot(
      await firstValueFrom(
        this.http.post<unknown>('/api/session', { username, password }).pipe(timeout(15000)),
      ),
    );
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.delete<void>('/api/session').pipe(timeout(15000)));
  }
}
