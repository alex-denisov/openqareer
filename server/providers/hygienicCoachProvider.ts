import { sanitizeHiddenMarkersDeep } from '../../shared/textHygiene';
import type { CoachTurnInput } from '../domain/coach';
import type { CoachProvider, CoachProviderResult } from './coachProvider';

/**
 * Последний слой перед кандидатом: ответ модели доходит до него без невидимых
 * меток (B210).
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ В КАЖДОМ ПРОВАЙДЕРЕ. Меток нет ни в одном провайдере по
 * отдельности — они приходят из модели. Очередь моделей длинная и растёт,
 * поэтому чистка стоит там, где сходятся все ответы: пропустить провайдер
 * мимо неё нельзя, потому что мимо неё нет пути.
 *
 * Чистится только текст ответа: маршрут, расход токенов и идентификаторы
 * остаются как есть — по ним разбирают инциденты.
 */
export class HygienicCoachProvider implements CoachProvider {
  private readonly inner: CoachProvider;

  constructor(options: { inner: CoachProvider }) {
    this.inner = options.inner;
  }

  async createTurn(
    input: CoachTurnInput,
    idempotencyKey: string,
  ): Promise<CoachProviderResult> {
    const answer = await this.inner.createTurn(input, idempotencyKey);
    const result = sanitizeHiddenMarkersDeep(answer.result);
    return result === answer.result ? answer : { ...answer, result };
  }
}
