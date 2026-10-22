import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { DomainSnapshot, VehicleHistory } from '@nexo/contracts';
import { readResponse } from '../http/read-response';
import { readSnapshot, readHistory, TelemetryProtocolError } from './telemetry-contract';

@Injectable({ providedIn: 'root' })
export class TelemetryApi {
  private readonly http = inject(HttpClient);
  async snapshot(signal: AbortSignal): Promise<DomainSnapshot> {
    return readSnapshot(await readResponse(this.http.get<unknown>('/api/snapshot'), signal));
  }
  async history(vehicleId: string, signal: AbortSignal): Promise<VehicleHistory> {
    if (!vehicleId.length) throw new TelemetryProtocolError();
    let path: string | undefined;
    try {
      const candidate = `/api/vehicles/${encodeURIComponent(vehicleId)}/events`;
      // NGINX rechaza %00 antes de llegar al controlador; JSON conserva el ID.
      if (
        candidate.length <= 4096 &&
        !vehicleId.includes('\u0000') &&
        new URL(candidate, 'http://localhost').pathname === candidate
      )
        path = candidate;
    } catch {
      /* JSON conserva una unidad sustituta que encodeURIComponent no admite. */
    }
    const request = path
      ? this.http.get<unknown>(path)
      : this.http.post<unknown>('/api/queries/vehicle-events', { vehicleId });
    return readHistory(await readResponse(request, signal), vehicleId);
  }
}
