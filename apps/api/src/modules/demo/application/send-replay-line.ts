import type { ReplayFailureCode, ReplayOutcome } from '../domain/replay.js';
export interface ReplayLine {
  readonly body: string;
  readonly eventId: string;
}
export type ReplayDelivery =
  | {
      readonly state: 'classified';
      readonly outcome: ReplayOutcome;
      readonly reasonCode: string | null;
    }
  | {
      readonly state: 'uncertain' | 'technical_failure';
      readonly closeCode: ReplayFailureCode;
      readonly httpStatus: number | null;
      readonly diagnosticDocument: string;
    };
export interface SendReplayLine {
  send(line: ReplayLine, ingestionId: string, signal: AbortSignal): Promise<ReplayDelivery>;
}
