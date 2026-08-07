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
}

export interface CoachProvider {
  createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<CoachProviderResult>;
}

export type ProviderErrorCode =
  | 'provider_rate_limited'
  | 'provider_budget_exhausted'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'provider_output_invalid';

export class CoachProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly statusCode: 429 | 502 | 503 | 504,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'CoachProviderError';
  }
}
