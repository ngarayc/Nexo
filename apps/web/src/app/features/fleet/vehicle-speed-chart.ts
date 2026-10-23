import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { EventView } from '@nexo/contracts';
import { IdentityText } from '../../platform/presentation/identity-text';
import { formatTime } from '../../platform/presentation/format-time';
import { SPEED_CHART_FACTORY } from './adapters/speed-chart-factory';
import type { SpeedChartRenderer } from './adapters/speed-chart-renderer';

@Component({
  selector: 'nexo-vehicle-speed-chart',
  imports: [IdentityText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="speed-chart-title">
      <h3 id="speed-chart-title">Velocidad observada</h3>
      <p id="speed-chart-description">
        {{ items().length === 1 ? '1 muestra recibida' : items().length + ' muestras recibidas' }}.
        Las líneas unen observaciones, sin suavizado ni muestras intermedias. Alerta cuando supera
        80 km/h.
      </p>
      <p>
        Los puntos representan la velocidad recibida; la línea discontinua marca la referencia de 80
        km/h. Puedes seleccionar una muestra en el gráfico o usar los botones del historial.
      </p>
      @if (items().length === 0) {
        <p>No hay muestras de velocidad disponibles.</p>
      }
      <div class="chart" [hidden]="items().length === 0">
        <canvas
          #canvas
          role="img"
          aria-label="Gráfico de velocidad observada en km/h"
          aria-describedby="speed-chart-description"
        >
          Los datos y acciones equivalentes están en la tabla de historial de observaciones.
        </canvas>
      </div>
      @if (observation(); as event) {
        <div class="selected-sample">
          <p>Muestra seleccionada:</p>
          <nexo-identity [value]="event.eventId" />
          <p>{{ formatTime(event.observedAt) }} · {{ event.speedKph }} km/h</p>
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      margin-block: 1.5rem;
    }
    section {
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fbfcff;
    }
    h3 {
      font-size: 15px;
      margin: 0 0 8px;
    }
    p {
      color: #65758b;
      font-size: 12px;
      line-height: 1.7;
    }
    .chart {
      position: relative;
      height: 22rem;
      width: 100%;
    }
    @media (max-width: 600px) {
      section {
        padding: 12px;
      }
      .chart {
        height: 18rem;
      }
    }
    canvas {
      display: block;
    }
    .selected-sample {
      background: #eef3fb;
      border-radius: 10px;
      padding: 0.75rem;
    }
  `,
})
export class VehicleSpeedChart {
  readonly items = input.required<readonly EventView[]>();
  readonly selected = input<string | null>(null);
  readonly selectEvent = output<string>();
  readonly observation = computed(() =>
    this.items().find((event) => event.eventId === this.selected()),
  );
  readonly formatTime = formatTime;
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly factory = inject(SPEED_CHART_FACTORY);
  private renderer?: SpeedChartRenderer;
  constructor() {
    afterRenderEffect(() => {
      const canvas = this.canvas()?.nativeElement,
        events = this.items(),
        selected = this.selected();
      if (!canvas || (!this.renderer && !events.length)) return;
      this.renderer ??= this.factory(canvas, (id) => this.selectEvent.emit(id));
      this.renderer.sync(events, selected);
    });
    inject(DestroyRef).onDestroy(() => this.renderer?.destroy());
  }
}
