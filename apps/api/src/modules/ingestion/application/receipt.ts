export type ItemOutcome = 'accepted' | 'duplicate' | 'rejected';

export interface Receipt {
  readonly ingestionId: string;
  readonly revision: number;
  readonly complete: boolean;
  readonly total: number;
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly results: readonly { index: number; eventId: string | null; outcome: ItemOutcome }[];
  readonly errors: readonly { index: number; eventId: string | null; reason: string }[];
  readonly pendingIndexes: readonly number[];
  readonly failedIndexes: readonly number[];
  readonly failures: readonly { index: number; code: string }[];
}
