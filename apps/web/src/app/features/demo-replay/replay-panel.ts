import type { IconName } from '../../platform/presentation/icon';
import { Icon } from '../../platform/presentation/icon';
import { ActionTooltip } from '../../platform/presentation/action-tooltip';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { ReplayAction, ReplayState, ReplayVerification, ReplayStage } from '@nexo/contracts';
import { formatTime } from '../../platform/presentation/format-time';
import { ReplayFacade } from './replay-facade';
import { summarizeReplayReport } from './replay-report-summary';

@Component({
  imports: [Icon, ActionTooltip],
  selector: 'nexo-replay-panel',
  templateUrl: './replay-panel.html',
  styleUrl: './replay-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplayPanel {
  readonly replay = inject(ReplayFacade);
  readonly minimized = signal(true);
  readonly tab = signal<'control' | 'deliveries' | 'verification'>('control');
  readonly intervalMs = signal(750);
  readonly lines = Array.from({ length: 24 }, (_, index) => index + 1);
  readonly formatTime = formatTime;
  readonly summarize = summarizeReplayReport;
  private readonly resetDialog = viewChild<ElementRef<HTMLDialogElement>>('resetDialog');
  requestReset(): void {
    if (this.replay.canReset()) this.resetDialog()?.nativeElement.showModal();
  }
  cancelReset(): void {
    this.resetDialog()?.nativeElement.close();
  }
  confirmReset(): void {
    this.cancelReset();
    void this.replay.reset();
  }
  tabsKey(event: KeyboardEvent): void {
    const tabs = ['control', 'deliveries', 'verification'] as const;
    const index = tabs.indexOf(this.tab());
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 2
          : event.key === 'ArrowRight'
            ? (index + 1) % 3
            : event.key === 'ArrowLeft'
              ? (index + 2) % 3
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const tab = tabs[next]!;
    this.tab.set(tab);
    document.getElementById('replay-' + tab + '-tab')?.focus();
  }
  readonly actions: readonly { action: ReplayAction; label: string; icon: IconName }[] = [
    { action: 'start', label: 'Iniciar reproducción', icon: 'play' },
    { action: 'pause', label: 'Pausar', icon: 'pause' },
    { action: 'resume', label: 'Reanudar', icon: 'play' },
    { action: 'restart', label: 'Reiniciar reproducción', icon: 'restart' },
    { action: 'finishVerification', label: 'Finalizar verificación', icon: 'check' },
  ];
  actionLabel(action: ReplayAction, label: string): string {
    return action === 'finishVerification' && this.replay.view()?.scenario?.closedAt
      ? 'Detener reproducción'
      : label;
  }
  act(action: ReplayAction) {
    void this.replay.execute(action, this.intervalMs());
  }
  state(state: ReplayState | undefined): string {
    return state
      ? {
          preparing: 'Preparando',
          running: 'Reproduciendo',
          pausing: 'Pausando',
          paused: 'Pausado',
          restarting: 'Reiniciando',
          finalizing: 'Finalizando',
          completed: 'Recorrido completado',
          stopped: 'Detenido',
          error: 'Detenido por un error',
          interrupted: 'Interrumpido',
        }[state]
      : 'Listo para comenzar';
  }
  verification(value: ReplayVerification | undefined) {
    return value
      ? {
          pending: 'Pendiente',
          conformant: 'Conforme',
          non_conformant: 'No conforme',
          inconclusive: 'Inconcluso',
        }[value]
      : 'Sin verificación';
  }
  stage(value: ReplayStage) {
    return {
      first: 'Primer recorrido oficial',
      second: 'Segundo recorrido oficial',
      exploratory: 'Recorrido exploratorio, fuera del par oficial',
    }[value];
  }
  attempt(line: number) {
    return this.replay.detail()?.attempts.find((a) => a.lineNumber === line);
  }
  outcome(line: number) {
    const attempt = this.attempt(line);
    if (!attempt) return 'Sin intentar';
    if (attempt.state === 'in_flight') return 'En curso';
    if (attempt.state === 'uncertain') return 'Resultado incierto';
    if (attempt.state === 'technical_failure') return 'Fallo técnico';
    return attempt.outcome
      ? { accepted: 'Aceptado', duplicate: 'Duplicado', rejected: 'Rechazado' }[attempt.outcome]
      : 'Sin clasificación';
  }
  check(state: string) {
    return (
      (
        {
          pending: 'Pendiente',
          matches: 'Coincide',
          differs: 'Difiere',
          unavailable: 'No se pudo comprobar',
        } as Record<string, string>
      )[state] ?? 'No se pudo comprobar'
    );
  }
  value(value: unknown): string {
    if (value === null || value === undefined) return 'No disponible';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (typeof value === 'number') return new Intl.NumberFormat('es-CO').format(value);
    if (typeof value === 'string') return value.length > 120 ? value.slice(0, 120) + '…' : value;
    if (Array.isArray(value)) return `${value.length} elementos; consulta los valores exactos`;
    if (typeof value === 'object') return 'Comparación de campos; consulta los valores exactos';
    return 'Valor no representable';
  }
  exact(value: unknown): string {
    const text = JSON.stringify(value, null, 2) ?? 'No disponible';
    return text.length > 12000 ? text.slice(0, 12000) + '\n… Detalle recortado en pantalla.' : text;
  }
}
