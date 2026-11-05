import { plainCoachText } from '../../shared/coachPlainText';
import { withoutSecondAsk } from './coachReplyShape';
import { sanitizeHiddenMarkersDeep, stripHiddenMarkers } from '../../shared/textHygiene';
import type { CoachTurnInput } from '../domain/coach';
import type { CoachProvider, CoachProviderResult, CoachTurnOptions } from './coachProvider';

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
    options?: CoachTurnOptions,
  ): Promise<CoachProviderResult> {
    // Шаг сервера возвращает JSON в message: его метки — данные, а не текст кандидату.
    const forCandidate = !input.internalPurpose;
    const answer = await this.inner.createTurn(input, idempotencyKey, cleanStream(options, forCandidate));
    const sanitized = sanitizeHiddenMarkersDeep(answer.result);
    const result = forCandidate ? withPlainReply(sanitized) : sanitized;
    return result === answer.result ? answer : { ...answer, result };
  }
}

/** The streamed reply reaches the candidate before the result does: it is cleaned the same way (29.10). */
function cleanStream(
  options: CoachTurnOptions | undefined,
  forCandidate: boolean,
): CoachTurnOptions | undefined {
  const sink = options?.onMessageText;
  if (!sink) return options;
  return {
    ...options,
    onMessageText: (text) => {
      const clean = stripHiddenMarkers(text);
      sink(forCandidate ? plainCoachText(clean) : clean);
    },
  };
}

/** Текст, который читает кандидат: служебные метки контекста сюда не проходят (B511 Д6). */
function withPlainReply(result: CoachProviderResult['result']): CoachProviderResult['result'] {
  const plain = (text: unknown) => (typeof text === 'string' ? plainCoachText(text) : text);
  const message = plain(result.message) as string;
  const nextQuestion = withoutSecondAsk(message, plain(result.nextQuestion) as string | null);
  return message === result.message && nextQuestion === result.nextQuestion
    ? result
    : { ...result, message, nextQuestion };
}
