import type { IngestionWork } from '../domain/work.js';
import type { TechnicalCode } from '../domain/recovery-policy.js';

export interface InspectionCursor {
  readonly receivedAt: string;
  readonly ingestionId: string;
}
export interface InspectionCandidate {
  readonly cursor: InspectionCursor;
  readonly work: IngestionWork | undefined;
  readonly jobId: string | null;
}
export type RecoveryResult = 'obsolete' | 'skipped' | 'waiting' | 'scheduled' | 'failed';
export interface RecoveryInspection {
  page(cursor: InspectionCursor | undefined): Promise<readonly InspectionCandidate[]>;
  recover(jobId: string, data: unknown, code?: TechnicalCode): Promise<RecoveryResult>;
}
export interface ReconciliationReport {
  inspected: number;
  changed: number;
  skipped: number;
  unverified: number;
}

export class ReconcileIngestion {
  private cursor: InspectionCursor | undefined;
  private running = false;
  constructor(private readonly inspection: RecoveryInspection) {}

  async runPass(signal: AbortSignal): Promise<ReconciliationReport | undefined> {
    if (this.running || signal.aborted) return;
    this.running = true;
    const report = { inspected: 0, changed: 0, skipped: 0, unverified: 0 };
    const deadline = Date.now() + 10000;
    try {
      while (report.inspected < 100 && !signal.aborted && Date.now() < deadline) {
        const page = await this.inspection.page(this.cursor);
        if (page.length === 0) {
          this.cursor = undefined;
          break;
        }
        for (const candidate of page) {
          if (signal.aborted || report.inspected >= 100 || Date.now() >= deadline) break;
          this.cursor = candidate.cursor;
          report.inspected += 1;
          if (!candidate.work || !candidate.jobId) {
            report.unverified += 1;
            continue;
          }
          try {
            const result = await this.inspection.recover(candidate.jobId, candidate.work);
            if (result === 'scheduled' || result === 'failed') report.changed += 1;
            else if (result === 'skipped' || result === 'obsolete') report.skipped += 1;
          } catch {
            // Una consulta fallida conserva incertidumbre; el cursor sí avanza
            // para que ese lote no impida revisar los siguientes.
            report.unverified += 1;
          }
        }
      }
      return report;
    } finally {
      this.running = false;
    }
  }
}
