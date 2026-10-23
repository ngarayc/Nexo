import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import type { SessionSnapshot } from '../../../platform/session/session-contract';
import { readResponse } from '../../../platform/http/read-response';

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
    (user.username !== 'demo' && user.username !== 'Demo') ||
    typeof data['expiresAt'] !== 'string' ||
    !Number.isFinite(Date.parse(data['expiresAt'])) ||
    typeof data['csrfToken'] !== 'string' ||
    !/^[a-f0-9]{256}$/.test(data['csrfToken'])
  )
    throw new Error('Respuesta de acceso inválida.');
  return {
    user: { id: user.id, username: user.username },
    expiresAt: data['expiresAt'],
    csrfToken: data['csrfToken'],
  };
}

@Injectable({ providedIn: 'root' })
export class SessionApi {
  private readonly http = inject(HttpClient);

  async current(signal?: AbortSignal): Promise<SessionSnapshot> {
    return readSnapshot(await readResponse(this.http.get<unknown>('/api/session'), signal));
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
