import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { ReplayCommandDto } from '@nexo/contracts';
import { readResponse } from '../http/read-response';
import {
  readReplayControl,
  readReplayAdmission,
  readReplayReceipt,
  readReplayDetail,
  readReplayHistory,
} from './replay-contract';

@Injectable({ providedIn: 'root' })
export class ReplayApi {
  private readonly http = inject(HttpClient);
  async reset(instanceId: string, expectedControlVersion: number, signal: AbortSignal) {
    const value = await readResponse(
      this.http.post<unknown>('/api/demo/replay/reset', {
        instanceId,
        expectedControlVersion,
        confirmation: 'CLEAR_DEMO',
      }),
      signal,
    );
    if (
      typeof value !== 'object' ||
      value === null ||
      !('cleared' in value) ||
      value.cleared !== true
    )
      throw new Error('Respuesta de limpieza no comprobable.');
  }
  async current(signal: AbortSignal) {
    return readReplayControl(
      await readResponse(this.http.get<unknown>('/api/demo/replay'), signal),
    );
  }
  async command(command: ReplayCommandDto, signal: AbortSignal) {
    return readReplayAdmission(
      await readResponse(this.http.post<unknown>('/api/demo/replay/commands', command), signal),
      command.commandId,
      command.instanceId,
    );
  }
  async receipt(commandId: string, instanceId: string, signal: AbortSignal) {
    return readReplayReceipt(
      await readResponse(
        this.http.get<unknown>('/api/demo/replay', { params: { commandId, instanceId } }),
        signal,
      ),
      commandId,
      instanceId,
    );
  }
  async detail(runId: string, signal: AbortSignal) {
    return readReplayDetail(
      await readResponse(this.http.get<unknown>('/api/demo/replay', { params: { runId } }), signal),
      runId,
    );
  }
  async history(signal: AbortSignal, cursor?: string) {
    return readReplayHistory(
      await readResponse(
        this.http.get<unknown>('/api/demo/replay', {
          params: { view: 'history', limit: '20', ...(cursor === undefined ? {} : { cursor }) },
        }),
        signal,
      ),
    );
  }
}
