import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip } from 'chart.js';
import type { ScriptableContext, TooltipItem } from 'chart.js';
import type { EventView } from '@nexo/contracts';
import { formatTime } from '../../../platform/presentation/format-time';
import { identityPreview } from '../../../platform/presentation/identity-text';
import { speedSeries } from './speed-series';
import type { SpeedSeries } from './speed-series';
import type { SpeedChartFactory, SpeedChartRenderer } from './speed-chart-renderer';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);
type Point = { x: number; y: number; event?: EventView };

class ChartJsSpeed implements SpeedChartRenderer {
  private readonly chart: Chart<'line', Point[]>;
  private series: SpeedSeries = speedSeries([]);
  private selected: string | null = null;

  constructor(canvas: HTMLCanvasElement, select: (eventId: string) => void) {
    const sample = (context: ScriptableContext<'line'>) =>
      context.datasetIndex === 0 ? this.series.samples[context.dataIndex] : undefined;
    const observed = (item: TooltipItem<'line'>) => this.series.samples[item.dataIndex]?.event;
    this.chart = new Chart<'line', Point[]>(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Velocidad recibida',
            data: [],
            clip: false,
            borderColor: '#78938f',
            borderWidth: 2,
            tension: 0,
            pointBackgroundColor: (context) =>
              sample(context)?.event.eventId === this.selected ? '#9c5410' : '#13766d',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1,
            pointRadius: (context) => (sample(context)?.event.eventId === this.selected ? 6 : 4),
            pointHoverRadius: 7,
            pointHitRadius: 4,
          },
          {
            label: 'Referencia 80 km/h',
            data: [],
            borderColor: '#9c5410',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 0,
            tension: 0,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        normalized: false,
        interaction: { mode: 'nearest', intersect: true },
        onClick: (_event, elements) => {
          const hit = elements.find((element) => element.datasetIndex === 0);
          const event = hit && this.series.samples[hit.index]?.event;
          if (event) select(event.eventId);
        },
        plugins: {
          tooltip: {
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: (items) => {
                const event = items[0] && observed(items[0]);
                return event ? formatTime(event.observedAt) : '';
              },
              label: (item) => {
                const event = observed(item);
                return event ? `${identityPreview(event.eventId)} · ${event.speedKph} km/h` : '';
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            bounds: 'data',
            min: 0,
            max: 1,
            title: { display: true, text: 'Fecha y hora Bogotá · 24h' },
            ticks: {
              maxTicksLimit: 4,
              maxRotation: 0,
              callback: (value) => this.tick(Number(value)),
            },
          },
          // Límites explícitos y cantidad fija evitan que el redondeo de un
          // máximo finito extremo construya un límite infinito en la biblioteca.
          y: {
            type: 'linear',
            bounds: 'data',
            min: 0,
            max: 80,
            title: { display: true, text: 'km/h' },
            ticks: {
              count: 5,
              callback: (value) =>
                Number(value).toLocaleString('es-CO', {
                  notation: Number(value) >= 1e6 ? 'scientific' : 'standard',
                  maximumSignificantDigits: 3,
                }),
            },
          },
        },
      },
    });
  }
  sync(events: readonly EventView[], selected: string | null): void {
    this.series = speedSeries(events);
    this.selected = selected;
    this.chart.data.datasets[0]!.data = [...this.series.samples];
    this.chart.data.datasets[1]!.data = [
      { x: 0, y: 80 },
      { x: this.series.maxX, y: 80 },
    ];
    this.chart.options.scales!['x']!.max = this.series.maxX;
    this.chart.options.scales!['y']!.max = this.series.maxY;
    this.chart.update('none');
  }
  private tick(value: number): string[] {
    const event = this.series.samples.find((sample) => sample.x === value)?.event;
    const milliseconds = this.series.startMilliseconds + value;
    if (!event && Math.abs(milliseconds) > 8_640_000_000_000_000) return [];
    return formatTime(event?.observedAt ?? milliseconds)
      .replace(' (Bogotá)', '')
      .split(' ');
  }
  destroy(): void {
    this.chart.destroy();
  }
}

export const createChartJsSpeed: SpeedChartFactory = (canvas, select) =>
  new ChartJsSpeed(canvas, select);
