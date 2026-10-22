import type {
  AttemptState,
  ReplayFailureCode,
  ReplayOutcome,
  ReplayProgress,
  ReplayStage,
  ReplayState,
  VerificationResult,
} from '../domain/replay.js';

export interface ReplayIntention {
  readonly commandId: string;
  readonly instanceId: string;
  readonly expectedControlVersion: number;
  readonly document: string;
}
export interface ReplayRun {
  readonly runId: string;
  readonly scenarioId: string;
  readonly previousRunId: string | null;
  readonly instanceId: string;
  readonly fixtureSha256: string;
  readonly stage: ReplayStage;
  readonly intervalMs: number;
  readonly state: ReplayState;
  readonly nextLine: number;
  readonly revision: number;
  readonly verification: VerificationResult;
  readonly verificationDocument: string | null;
  readonly scenarioVerification: VerificationResult;
  readonly scenarioDocument: string | null;
  readonly scenarioClosedAt: string | null;
  readonly closeCode: ReplayFailureCode | null;
  readonly intention: ReplayIntention | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface ReplayAttempt {
  readonly runId: string;
  readonly lineNumber: number;
  readonly batchIndex: 0;
  readonly ingestionId: string;
  readonly eventId: string | null;
  readonly state: AttemptState;
  readonly outcome: ReplayOutcome | null;
  readonly reasonCode: string | null;
  readonly httpStatus: number | null;
  readonly diagnosticDocument: string | null;
  readonly startedAt: string;
  readonly finalizedAt: string | null;
}
export interface ReplaySnapshot {
  readonly run: ReplayRun;
  readonly attempts: readonly ReplayAttempt[];
  readonly progress: ReplayProgress;
}
export interface NewReplayRun {
  readonly runId: string;
  readonly scenarioId: string;
  readonly previousRunId: string | null;
  readonly instanceId: string;
  readonly fixtureSha256: string;
  readonly stage: ReplayStage;
  readonly intervalMs: number;
  readonly intention?: ReplayIntention;
}
export interface ReplayTransition {
  readonly state: ReplayState;
  readonly intervalMs?: number;
  readonly closeCode?: ReplayFailureCode;
  readonly intention?: ReplayIntention;
}
export type AttemptResolution =
  | {
      readonly state: 'classified';
      readonly outcome: ReplayOutcome;
      readonly reasonCode: string | null;
    }
  | {
      readonly state: 'uncertain' | 'technical_failure';
      readonly httpStatus: number | null;
      readonly diagnosticDocument: string;
    };
export interface HistoryPage {
  readonly items: readonly ReplayRun[];
  readonly nextCursor: string | null;
}

// Ningún método envía HTTP. Cada mutación termina antes de delegar al emisor;
// su fallo no demuestra si el COMMIT llegó a confirmarse.
export interface ReplayJournal {
  create(input: NewReplayRun): Promise<ReplaySnapshot>;
  find(runId: string): Promise<ReplaySnapshot | undefined>;
  current(): Promise<ReplaySnapshot | undefined>;
  history(limit?: number, cursor?: string): Promise<HistoryPage>;
  transition(runId: string, revision: number, change: ReplayTransition): Promise<ReplaySnapshot>;
  beginAttempt(
    runId: string,
    revision: number,
    ingestionId: string,
    eventId: string | null,
  ): Promise<ReplaySnapshot>;
  resolveAttempt(
    runId: string,
    revision: number,
    result: AttemptResolution,
    change: ReplayTransition,
  ): Promise<ReplaySnapshot>;
  verify(
    runId: string,
    revision: number,
    result: Exclude<VerificationResult, 'pending'>,
    document: string,
  ): Promise<ReplaySnapshot>;
  closeScenario(
    runId: string,
    revision: number,
    result: Exclude<VerificationResult, 'pending'>,
    document: string,
  ): Promise<ReplaySnapshot>;
  recover(): Promise<number>;
}
