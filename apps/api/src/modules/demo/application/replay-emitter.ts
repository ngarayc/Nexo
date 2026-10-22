import type { ReplayDelivery, ReplayLine, SendReplayLine } from './send-replay-line.js';
import { replayDiagnostic, ReplayInvariantError } from '../domain/replay.js';

export interface ReplayDispatch {
  readonly line: ReplayLine;
  readonly ingestionId: string;
}
export interface ReplayEmissionJournal {
  // Confirma el intento bajo la coordinación corta; null significa no enviar.
  claim(): Promise<ReplayDispatch | null>;
  // Confirma resultado y cursor. El intervalo empieza después de este COMMIT.
  settle(dispatch: ReplayDispatch, delivery: ReplayDelivery): Promise<number | null>;
  // Un fallo del diario bloquea nuevos despachos; no demuestra rollback.
  blocked(): void;
}

// Solo organiza temporizadores y una petición. La política de comandos y sus
// transacciones pertenecen al coordinador; nunca conserva un bloqueo en HTTP.
export class ReplayEmitter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | undefined;
  private enabled = false;
  private closed = false;
  private generation = 0;
  private delay = 0;
  private readonly abort = new AbortController();

  constructor(
    private readonly journal: ReplayEmissionJournal,
    private readonly producer: SendReplayLine,
  ) {}

  get inFlight(): boolean {
    return this.flight !== undefined;
  }
  arm(delay: number): void {
    if (!Number.isInteger(delay) || delay < 0 || delay > 5000) throw new ReplayInvariantError();
    if (this.closed) return;
    this.cancelTimer();
    this.generation++;
    this.enabled = true;
    this.delay = delay;
    this.schedule();
  }
  inhibit(): void {
    this.enabled = false;
    this.generation++;
    this.cancelTimer();
  }
  close(): void {
    this.closed = true;
    this.inhibit();
    this.abort.abort();
  }
  async whenIdle(): Promise<void> {
    await this.flight;
  }
  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private schedule(): void {
    if (!this.enabled || this.closed || this.flight || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.enabled || this.closed || this.flight) return;
      const generation = this.generation;
      // Promise.resolve difiere claim hasta que flight ya representa su dueño.
      this.flight = Promise.resolve().then(() => this.dispatch(generation));
      void this.flight.finally(() => {
        this.flight = undefined;
        this.schedule();
      });
    }, this.delay);
    this.timer.unref?.();
  }
  private async dispatch(generation: number): Promise<void> {
    try {
      if (!this.enabled || this.closed) return;
      const dispatch = await this.journal.claim();
      if (dispatch === null) {
        if (generation === this.generation) this.inhibit();
        return;
      }
      // claim ya autorizó este envío. Una pausa concurrente inhibe el siguiente
      // y deja resolver este intento, incluso si la respuesta tarda.
      let delivery: ReplayDelivery;
      try {
        delivery = await this.producer.send(dispatch.line, dispatch.ingestionId, this.abort.signal);
      } catch {
        delivery = {
          state: 'uncertain',
          closeCode: 'TRANSPORT_UNCERTAIN',
          httpStatus: null,
          diagnosticDocument: replayDiagnostic('TRANSPORT_UNCERTAIN'),
        };
      }
      const next = await this.journal.settle(dispatch, delivery);
      if (generation === this.generation) {
        if (next === null) this.inhibit();
        else {
          if (!Number.isInteger(next) || next < 100 || next > 5000)
            throw new ReplayInvariantError();
          this.delay = next;
        }
      }
    } catch {
      this.inhibit();
      // La notificación no debe convertir un fallo en rechazo no manejado ni
      // habilitar un reintento. La coordinación conserva el motivo cerrado.
      try {
        this.journal.blocked();
      } catch {
        // Sigue bloqueado aunque falle el observador.
      }
    }
  }
}
