import { describe, expect, it } from 'vitest';
import type { RejectionReview } from '../../../../../shared/rejectionReview';
import { guessLine, recommendationText, reviewTitle } from './reviewText';

const BASE: RejectionReview = {
  state: 'ready',
  sentCount: 21,
  threshold: 20,
  rejectedCount: 3,
  rejections: [],
  firstStep: null,
  recommendations: [],
  helped: null,
};

describe('B679: тексты разбора отказов', () => {
  it('догадка называет требование вакансии и факт профиля', () => {
    expect(guessLine({ requirement: 'Команда от 20 человек', quote: 'q', profileFact: 'команда 9' })).toBe(
      'Вероятно, не хватило: Команда от 20 человек — так в вакансии; в профиле: команда 9',
    );
    expect(guessLine({ requirement: 'Брокерские системы', quote: 'q', profileFact: null })).toBe(
      'Вероятно, не хватило: Брокерские системы — так в вакансии; подтверждения в профиле не нашли',
    );
  });

  it('рекомендация ведёт туда, где это правится', () => {
    const resume = recommendationText({ kind: 'show_in_resume', requirement: 'Команда от 20', profileFact: 'команда 9', count: 2, total: 3 });
    expect(resume).toMatchObject({ title: 'Показать в резюме: Команда от 20', node: 's01' });
    expect(resume.why).toBe('2 из 3 отказов: в вакансии — Команда от 20, в профиле: команда 9.');
    expect(recommendationText({ kind: 'match_vacancies', requirement: 'Брокеры', profileFact: null, count: 1, total: 3 }).node).toBe('s07');
    expect(recommendationText({ kind: 'update_statuses', requirement: null, profileFact: null, count: 3, total: 6 })).toMatchObject({
      title: 'Обновить статусы откликов',
      why: 'Без ответа — 3 из 6.',
      node: 'o01',
    });
  });

  it('заголовок экрана по состоянию', () => {
    expect(reviewTitle({ ...BASE, state: 'low_data', sentCount: 6 })).toBe('Мало данных для вывода: 6 откликов');
    expect(reviewTitle(BASE)).toBe('3 отказа на 21 отклик');
    expect(
      reviewTitle({ ...BASE, firstStep: { kind: 'show_in_resume', requirement: 'Команда от 20', profileFact: 'команда 9', count: 2, total: 3 } }),
    ).toBe('Показать в резюме: Команда от 20');
  });
});
