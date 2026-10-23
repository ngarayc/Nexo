// DTO del control compartido. No incorpora red, SQL o decisiones del emisor.
export type ReplayAction = 'start' | 'pause' | 'resume' | 'restart' | 'finishVerification';
export type ReplayState =
  | 'preparing'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'restarting'
  | 'finalizing'
  | 'completed'
  | 'stopped'
  | 'error'
  | 'interrupted';
export type ReplayVerification = 'pending' | 'conformant' | 'non_conformant' | 'inconclusive';
export type ReplayStage = 'first' | 'second' | 'exploratory';
export interface ReplayProgressDto {
  readonly total: 24;
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly classified: number;
  readonly inFlight: number;
  readonly uncertain: number;
  readonly technicalFailure: number;
  readonly unattempted: number;
  readonly nextLine: number;
}
export interface ReplayControlRun {
  readonly runId: string;
  readonly scenarioId: string;
  readonly stage: ReplayStage;
  readonly state: ReplayState;
  readonly verification: ReplayVerification;
  readonly intervalMs: number;
  readonly nextLine: number;
  readonly closeCode: string | null;
  readonly progress: ReplayProgressDto;
}
export interface ReplayScenarioDto {
  readonly scenarioId: string;
  readonly verification: ReplayVerification;
  readonly closedAt: string | null;
}
export interface ReplayControl {
  readonly instanceId: string;
  readonly controlVersion: number;
  readonly viewRevision: number;
  readonly observedAt: string;
  readonly blockedReason: 'RECOVERING' | 'JOURNAL_UNCERTAIN' | 'SHUTTING_DOWN' | null;
  readonly allowedActions: readonly ReplayAction[];
  readonly pendingAction: ReplayAction | null;
  readonly scenario: ReplayScenarioDto | null;
  readonly run: ReplayControlRun | null;
}
export interface ReplayStreamFrame extends ReplayControl {
  readonly type: 'demo.replay.updated';
  readonly schemaVersion: 1;
  readonly streamInstanceId: string;
}
export interface ReplayCommandDto {
  readonly commandId: string;
  readonly instanceId: string;
  readonly expectedControlVersion: number;
  readonly runId: string | null;
  readonly action: ReplayAction;
  readonly intervalMs?: number;
}
export interface ReplayAdmissionDto {
  readonly commandId: string;
  readonly instanceId: string;
  readonly runId: string;
  readonly admittedControlVersion: number;
  readonly accepted: true;
}
export interface ReplayCommandReceiptDto {
  readonly admission: ReplayAdmissionDto;
  readonly resolution: 'pending' | 'completed' | 'failed';
  readonly reasonCode: string | null;
}
export interface ReplayRunDto {
  readonly runId: string;
  readonly scenarioId: string;
  readonly previousRunId: string | null;
  readonly instanceId: string;
  readonly stage: ReplayStage;
  readonly state: ReplayState;
  readonly intervalMs: number;
  readonly nextLine: number;
  readonly revision: number;
  readonly verification: ReplayVerification;
  readonly closeCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface ReplayReportDto {
  readonly version: 1;
  readonly scope: 'data-and-replays';
  readonly phase: 'preparation' | 'first' | 'second';
  readonly result: Exclude<ReplayVerification, 'pending'>;
  readonly observedAt: string | null;
  readonly attemptedAt: string;
  readonly runId: string | null;
  readonly scenarioId: string | null;
  readonly runRevision: number | null;
  readonly environment: null | {
    readonly instanceId: string;
    readonly ready: boolean;
    readonly softwareFingerprint: string;
    readonly configurationFingerprint: string;
  };
  readonly sources: Readonly<Record<string, string>>;
  readonly snapshotFingerprint: string | null;
  readonly checks: readonly {
    readonly key: string;
    readonly label: string;
    readonly source: string;
    readonly expected: unknown;
    readonly observed: unknown;
    readonly state: 'pending' | 'matches' | 'differs' | 'unavailable';
  }[];
  readonly externalEvidence: Readonly<{
    twoRenderedClients: 'not_assessed';
    pauseResume: 'not_assessed';
    ci: 'not_assessed';
  }>;
}
export interface ReplayDetailDto {
  readonly run: ReplayRunDto;
  readonly progress: ReplayProgressDto;
  readonly scenario: ReplayScenarioDto & { readonly report: ReplayReportDto | null };
  readonly attempts: readonly {
    readonly runId: string;
    readonly lineNumber: number;
    readonly batchIndex: 0;
    readonly ingestionId: string;
    readonly eventId: string | null;
    readonly state: 'in_flight' | 'classified' | 'uncertain' | 'technical_failure';
    readonly outcome: 'accepted' | 'duplicate' | 'rejected' | null;
    readonly reasonCode: string | null;
    readonly httpStatus: number | null;
    readonly diagnostic: Readonly<Record<string, string | number | boolean>> | null;
    readonly startedAt: string;
    readonly finalizedAt: string | null;
  }[];
  readonly inspection: {
    readonly report: ReplayReportDto;
    readonly currentState: 'same' | 'changed' | 'unavailable';
    readonly currentObservedAt: string | null;
  };
}
export interface ReplayHistoryDto {
  readonly items: readonly ReplayRunDto[];
  readonly nextCursor: string | null;
}
