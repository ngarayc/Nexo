import type {
  ReplayOutcome,
  ReplayStage,
  ReplayState,
  VerificationResult,
} from '../domain/replay.js';

export interface ReplayEnvironment {
  readonly instanceId: string;
  readonly ready: boolean;
  readonly softwareFingerprint: string;
  readonly configurationFingerprint: string;
}
export function replayEnvironmentValid(value: ReplayEnvironment): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value.instanceId,
    ) &&
    typeof value.ready === 'boolean' &&
    /^[a-f0-9]{64}$/.test(value.softwareFingerprint) &&
    /^[a-f0-9]{64}$/.test(value.configurationFingerprint)
  );
}
export interface EvidenceRun {
  readonly runId: string;
  readonly scenarioId: string;
  readonly previousRunId: string | null;
  readonly instanceId: string;
  readonly fixtureSha256: string;
  readonly stage: ReplayStage;
  readonly state: ReplayState;
  readonly nextLine: number;
  readonly revision: number;
  readonly verification: VerificationResult;
  readonly verificationDocument: string | null;
  readonly scenarioVerification: VerificationResult;
  readonly scenarioClosedAt: string | null;
}
export interface EvidenceAttempt {
  readonly runId: string;
  readonly lineNumber: number;
  readonly batchIndex: number;
  readonly ingestionId: string;
  readonly eventId: string | null;
  readonly state: string;
  readonly outcome: ReplayOutcome | null;
  readonly reasonCode: string | null;
}
export interface EvidenceReceipt {
  readonly ingestionId: string;
  readonly state: string;
  readonly total: number;
  readonly nextIndex: number;
  readonly requestMatches: boolean;
  readonly itemIndex: number | null;
  readonly itemState: string | null;
  readonly inputMatches: boolean | null;
  readonly outcome: string | null;
  readonly reasonCode: string | null;
  readonly resolvedEventId: string | null;
}
export interface EvidenceEvent {
  readonly eventId: string;
  readonly vehicleId: string;
  readonly observedAt: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly ignitionOn: boolean;
  readonly extraEmpty: boolean;
}
export interface ReplayEvidence {
  readonly observedAt: string;
  readonly environment: ReplayEnvironment;
  readonly counts: Readonly<{
    events: number;
    vehicles: number;
    alerts: number;
    messages: number;
    pendingMessages: number;
    receipts: number;
    activeReceipts: number;
    failedReceipts: number;
    runs: number;
    attempts: number;
  }>;
  readonly runs: readonly EvidenceRun[];
  readonly attempts: readonly EvidenceAttempt[];
  readonly receiptIds: readonly string[];
  readonly receipts: readonly EvidenceReceipt[];
  readonly events: readonly EvidenceEvent[];
  readonly latest: readonly (EvidenceEvent & { readonly status: 'MOVING' | 'STOPPED' | 'OFF' })[];
  readonly alerts: readonly EvidenceEvent[];
  readonly messages: readonly {
    readonly eventId: string;
    readonly type: string;
    readonly published: boolean;
  }[];
  readonly jobs: Readonly<{ complete: boolean; queued: number; active: number }>;
}
export interface ReadReplayEvidence {
  read(runId?: string): Promise<ReplayEvidence>;
}
export type CheckState = 'pending' | 'matches' | 'differs' | 'unavailable';
export interface VerificationCheck {
  readonly key: string;
  readonly label: string;
  readonly source: string;
  readonly expected: unknown;
  readonly observed: unknown;
  readonly state: CheckState;
}
export interface ReplayReport {
  readonly version: 1;
  readonly scope: 'data-and-replays';
  readonly phase: 'preparation' | 'first' | 'second';
  readonly result: 'conformant' | 'non_conformant' | 'inconclusive';
  readonly observedAt: string | null;
  readonly attemptedAt: string;
  readonly runId: string | null;
  readonly scenarioId: string | null;
  readonly runRevision: number | null;
  readonly environment: ReplayEnvironment | null;
  readonly sources: Readonly<Record<string, string>>;
  readonly snapshotFingerprint: string | null;
  readonly checks: readonly VerificationCheck[];
  readonly externalEvidence: Readonly<{
    twoRenderedClients: 'not_assessed';
    pauseResume: 'not_assessed';
    ci: 'not_assessed';
    video: 'not_assessed';
  }>;
}
export interface ReplayInspection {
  readonly report: ReplayReport;
  readonly currentState: 'same' | 'changed' | 'unavailable';
  readonly currentObservedAt: string | null;
}
