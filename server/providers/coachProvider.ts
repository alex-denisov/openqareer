import type {
  CoachTurnInput,
  CoachTurnResult,
} from '../domain/coach';
import type { ProviderId } from './modelRegistry';

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CoachProviderResult {
  result: CoachTurnResult;
  provider: ProviderId;
  model: string;
  responseId: string;
  usage: ProviderUsage;
  routing?: {
    fallbackUsed: boolean;
    attempts: Array<{
      provider: ProviderId;
      /**
       * Очередь состоит из моделей: две ступени могут жить за одним
       * провайдером, и без имени модели их не различить (B183).
       */
      model?: string;
      status: 'succeeded' | 'failed' | 'skipped';
      code?: ProviderErrorCode | 'provider_cooldown';
    }>;
  };
}

export interface CoachTurnOptions {
  /**
   * A server step that reads structured output rejects an answer it cannot use; the provider
   * queue then asks the next route instead of returning it (B564).
   */
  readonly accept?: (result: CoachProviderResult['result']) => boolean;
}

export interface CoachProvider {
  createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
    options?: CoachTurnOptions,
  ): Promise<CoachProviderResult>;
}

export type ProviderErrorCode =
  | 'provider_rate_limited'
  | 'provider_budget_exhausted'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'provider_output_invalid';

export type ProviderOutputDiagnostic =
  | 'response_incomplete_max_output_tokens'
  | 'response_incomplete_other'
  | 'response_refusal'
  | 'response_text_missing'
  | 'response_json_invalid'
  | 'response_schema_invalid';

export class CoachProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly statusCode: 429 | 502 | 503 | 504,
    readonly retryable: boolean,
    readonly diagnostic?: ProviderOutputDiagnostic,
    readonly role?: CoachTurnInput['activeRole'],
    /** Every route tried before giving up: the journal names who failed and how. */
    readonly attempts?: NonNullable<CoachProviderResult['routing']>['attempts'],
  ) {
    super(code);
    this.name = 'CoachProviderError';
  }
}
