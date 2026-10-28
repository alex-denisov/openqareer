import type { CoachTurnInput } from '../domain/coach';
import { fitCoachTurnInput } from '../domain/coachInputBudget';
import type { CoachProvider, CoachProviderResult, CoachTurnOptions } from './coachProvider';

/**
 * Вход хода укладывается в 16K токенов до очереди моделей (B580): каждая
 * ступень, включая запасные, получает одну и ту же урезанную историю.
 */
export class BudgetedCoachProvider implements CoachProvider {
  private readonly inner: CoachProvider;

  constructor(options: { inner: CoachProvider }) {
    this.inner = options.inner;
  }

  createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
    options?: CoachTurnOptions,
  ): Promise<CoachProviderResult> {
    return this.inner.createTurn(fitCoachTurnInput(input), idempotencyKey, options);
  }
}
