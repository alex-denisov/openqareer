import { describe, expect, it } from 'vitest';
import { rateLimitMessage, retryAfterSeconds } from './rateLimitMessage';

describe('PRB-015 — сообщение о лимите называет настоящее ожидание', () => {
  it('называет реальное окно в минутах', () => {
    expect(rateLimitMessage(900)).toBe(
      'Слишком много запросов. Повторите действие через 15 минут.',
    );
    expect(rateLimitMessage(60)).toBe('Слишком много запросов. Повторите действие через 1 минуту.');
    expect(rateLimitMessage(180)).toBe(
      'Слишком много запросов. Повторите действие через 3 минуты.',
    );
    expect(rateLimitMessage(3_600)).toBe(
      'Слишком много запросов. Повторите действие через 60 минут.',
    );
  });

  it('округляет неполную минуту вверх — раньше повторять бессмысленно', () => {
    expect(rateLimitMessage(1)).toBe('Слишком много запросов. Повторите действие через 1 минуту.');
    expect(rateLimitMessage(61)).toBe('Слишком много запросов. Повторите действие через 2 минуты.');
  });

  it('не выдумывает срок, когда лимитер его не назвал', () => {
    for (const unknown of [null, 0, -5, Number.NaN]) {
      expect(rateLimitMessage(unknown)).toBe('Слишком много запросов. Повторите действие позже.');
    }
  });
});

describe('reading the wait out of the limiter header', () => {
  it('accepts the header in every shape fastify sends it', () => {
    expect(retryAfterSeconds('900')).toBe(900);
    expect(retryAfterSeconds(900)).toBe(900);
  });

  it('refuses to invent a wait the limiter did not name', () => {
    expect(retryAfterSeconds(undefined)).toBeNull();
    expect(retryAfterSeconds(['900'])).toBeNull();
    expect(retryAfterSeconds('позже')).toBeNull();
    expect(retryAfterSeconds(Number.NaN)).toBeNull();
  });
});
