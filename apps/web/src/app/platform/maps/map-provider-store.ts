import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { readMapProvider } from './map-provider-config';
import type { MapProvider } from './map-provider-config';

@Injectable({ providedIn: 'root' })
export class MapProviderStore {
  private readonly http = inject(HttpClient);
  private readonly value = signal<MapProvider | undefined>(undefined);
  private readonly phaseValue = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly provider = this.value.asReadonly();
  readonly phase = this.phaseValue.asReadonly();

  load(): void {
    if (this.phaseValue() === 'loading' || this.value()) return;
    this.phaseValue.set('loading');
    this.http.get<unknown>('/map-provider.json').subscribe({
      next: (input) => {
        try {
          this.value.set(readMapProvider(input));
          this.phaseValue.set('ready');
        } catch {
          this.phaseValue.set('error');
        }
      },
      error: () => this.phaseValue.set('error'),
    });
  }
}
