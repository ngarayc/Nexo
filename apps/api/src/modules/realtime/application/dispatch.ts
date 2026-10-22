import { performance } from 'node:perf_hooks';

export const dispatchLimits = Object.freeze({ messages: 100, bytes: 2 * 1024 * 1024 });
export interface PendingMessage {
  readonly messageId: string;
  readonly frameBytes: number;
  readonly type: string;
  readonly schemaVersion: number;
}
export interface OutboxMetrics {
  readonly pending: number;
  readonly oldestMilliseconds: number;
  readonly failures: number;
}
export interface OutboxStore {
  metadata(): Promise<readonly PendingMessage[]>;
  payloads(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  publish(ids: readonly string[]): Promise<void>;
  published(ids: readonly string[]): Promise<ReadonlyMap<string, boolean>>;
  fail(ids: readonly string[], code: OutboxFailure): Promise<void>;
  metrics(): Promise<OutboxMetrics>;
}
export type OutboxFailure =
  'OUTBOX_PAYLOAD_INVALID' | 'OUTBOX_PUBLICATION_FAILED' | 'OUTBOX_MARK_UNCONFIRMED';

// La selección precede a la carga de payloads. Una trama mayor va aislada.
export function selectGroup(metadata: readonly PendingMessage[]): readonly PendingMessage[] {
  if (metadata.length > dispatchLimits.messages) throw new Error('OUTBOX_METADATA_INVALID');
  const selected: PendingMessage[] = [];
  let bytes = 0;
  for (const item of metadata) {
    if (!Number.isSafeInteger(item.frameBytes) || item.frameBytes <= 0)
      throw new Error('OUTBOX_METADATA_INVALID');
    if (selected.length && bytes + item.frameBytes > dispatchLimits.bytes) break;
    selected.push(item);
    bytes += item.frameBytes;
    if (bytes >= dispatchLimits.bytes) break;
  }
  return selected;
}

export class OutboxReadiness {
  private reviewedAt: number | undefined;
  private metricsValue: OutboxMetrics | undefined;
  private interrupted = true;

  constructor(private readonly now: () => number = () => performance.now()) {}

  observe(metrics: OutboxMetrics): void {
    this.metricsValue = metrics;
    this.reviewedAt = this.now();
    this.interrupted = false;
  }
  interrupt(): void {
    this.interrupted = true;
  }
  get reviewDue(): boolean {
    return this.interrupted || this.reviewedAt === undefined || this.now() - this.reviewedAt >= 250;
  }
  get healthy(): boolean {
    return (
      !this.interrupted &&
      this.reviewedAt !== undefined &&
      this.now() - this.reviewedAt < 10000 &&
      this.metricsValue !== undefined &&
      this.metricsValue.failures === 0 &&
      this.metricsValue.oldestMilliseconds +
        (this.metricsValue.pending > 0 ? this.now() - this.reviewedAt : 0) <=
        30000
    );
  }
}

// El puerto store devuelve cada lectura sin retener un cliente/transacción.
export class DispatchOutbox {
  constructor(
    private readonly store: OutboxStore,
    private readonly frame: (metadata: PendingMessage, payload: string) => string,
    private readonly distribute: (frame: string) => void,
    readonly readiness: OutboxReadiness,
  ) {}

  async group(signal: AbortSignal): Promise<boolean> {
    try {
      signal.throwIfAborted();
      const metadata = await this.store.metadata();
      const selected = selectGroup(metadata);
      signal.throwIfAborted();
      if (selected.length) {
        const payloads = await this.store.payloads(selected.map((item) => item.messageId));
        const invalid: string[] = [],
          failed: string[] = [],
          sent: string[] = [];
        for (const item of selected) {
          signal.throwIfAborted();
          let frame: string;
          try {
            const payload = payloads.get(item.messageId);
            if (payload === undefined) throw new Error('OUTBOX_PAYLOAD_INVALID');
            frame = this.frame(item, payload);
          } catch {
            invalid.push(item.messageId);
            continue;
          }
          try {
            this.distribute(frame);
            sent.push(item.messageId);
          } catch {
            failed.push(item.messageId);
          }
        }
        signal.throwIfAborted();
        if (invalid.length) {
          this.readiness.interrupt();
          await this.store.fail(invalid, 'OUTBOX_PAYLOAD_INVALID');
        }
        signal.throwIfAborted();
        if (failed.length) {
          this.readiness.interrupt();
          await this.store.fail(failed, 'OUTBOX_PUBLICATION_FAILED');
        }
        signal.throwIfAborted();
        if (sent.length) {
          try {
            await this.store.publish(sent);
          } catch {
            signal.throwIfAborted();
            // Un error al marcar no demuestra rollback. Releer antes de repetir.
            const published = await this.store.published(sent);
            if (sent.some((id) => !published.has(id))) throw new Error('OUTBOX_STATE_UNAVAILABLE');
            const pending = sent.filter((id) => published.get(id) === false);
            signal.throwIfAborted();
            if (pending.length) {
              this.readiness.interrupt();
              await this.store.fail(pending, 'OUTBOX_MARK_UNCONFIRMED');
            }
          }
        }
      }
      signal.throwIfAborted();
      const more = metadata.length === dispatchLimits.messages || selected.length < metadata.length;
      // Al drenar muchos grupos no repetir el agregado pesado por cada cien filas.
      if (!more || this.readiness.reviewDue) this.readiness.observe(await this.store.metrics());
      return more;
    } catch (error) {
      this.readiness.interrupt();
      throw error;
    }
  }
}
