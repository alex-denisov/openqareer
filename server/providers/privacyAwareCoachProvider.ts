import type { CoachTurnInput } from '../domain/coach';
import type {
  CoachProvider,
  CoachProviderResult,
  CoachTurnOptions,
} from './coachProvider';

interface PrivacyAwareCoachProviderOptions {
  personalDataProvider: CoachProvider;
  syntheticDataProvider: CoachProvider;
}
export class PrivacyAwareCoachProvider implements CoachProvider {
  private readonly personalDataProvider: CoachProvider;
  private readonly syntheticDataProvider: CoachProvider;

  constructor(options: PrivacyAwareCoachProviderOptions) {
    this.personalDataProvider = options.personalDataProvider;
    this.syntheticDataProvider = options.syntheticDataProvider;
  }

  createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
    options?: CoachTurnOptions,
  ): Promise<CoachProviderResult> {
    if (input.dataClass === 'synthetic') {
      return this.syntheticDataProvider.createTurn(input, idempotencyKey, options);
    }
    return this.personalDataProvider.createTurn(input, idempotencyKey, options);
  }
}
