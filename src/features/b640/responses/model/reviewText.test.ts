import { describe, expect, it } from 'vitest';
import type { RejectionReview } from '../../../../../shared/rejectionReview';
import { guessLine, rejectionsTitle, recommendationText, resumePathOf, reviewTitle } from './reviewText';

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

  it('правка резюме открывается над «Резюме» последнего отказа с тем же требованием', () => {
    const item = (applicationId: string, requirement: string, rejectedAt: string) => ({
      applicationId,
      title: 'Роль',
      company: null,
      rejectedAt,
      guess: { requirement, quote: 'q', profileFact: null },
      candidateReason: null,
    });
    const step = { kind: 'show_in_resume' as const, requirement: 'Команда', profileFact: 'к', count: 2, total: 3 };
    const items = [item('old', 'Команда', '2026-11-01'), item('new', 'Команда', '2026-11-09'), item('x', 'SQL', '2026-11-20')];
    expect(resumePathOf(step, items)).toBe('/app/responses/new/letter?step=resume');
    expect(resumePathOf({ ...step, requirement: 'Нет' }, items)).toBeNull();
  });

  it('рекомендация ведёт туда, где это правится', () => {
    const resume = recommendationText({ kind: 'show_in_resume', requirement: 'Команда от 20', profileFact: 'команда 9', count: 2, total: 3 });
    expect(resume).toMatchObject({ title: 'Показать в резюме: Команда от 20', node: 's01' });
    expect(resume.action).toBe('Открыть профиль');
    expect(
      recommendationText({ kind: 'show_in_resume', requirement: 'Команда от 20', profileFact: 'команда 9', resumeFactId: 'm1', count: 2, total: 3 }).action,
    ).toBe('Поправить резюме');
    expect(resume.why).toBe('2 из 3 отказов: в вакансии — Команда от 20, в профиле: команда 9.');
    expect(recommendationText({ kind: 'match_vacancies', requirement: 'Брокеры', profileFact: null, count: 1, total: 3 }).node).toBe('s07');
    expect(recommendationText({ kind: 'update_statuses', requirement: null, profileFact: null, count: 3, total: 6 })).toMatchObject({
      title: 'Обновить статусы откликов',
      why: 'Без ответа — 3 из 6.',
      node: 'o01',
    });
  });

  it('заголовок списка отказов: число и «за месяц», только если все — за месяц', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    const at = (...dates: string[]) => dates.map((rejectedAt) => ({ rejectedAt }));
    expect(rejectionsTitle(at('2026-11-09', '2026-10-29', '2026-10-25'), 3, now)).toBe('Три отказа за месяц');
    expect(rejectionsTitle(at('2026-11-09', '2026-08-01'), 2, now)).toBe('Два отказа');
    expect(rejectionsTitle(at('2026-11-09'), 1, now)).toBe('Один отказ за месяц');
    expect(rejectionsTitle(at(...Array<string>(11).fill('2026-11-09')), 11, now)).toBe('11 отказов за месяц');
    // Показаны не все: число списка не равно числу отказов, поэтому числа нет.
    expect(rejectionsTitle(at('2026-11-09'), 21, now)).toBe('Отказы');
    expect(rejectionsTitle(at('не дата'), 1, now)).toBe('Один отказ');
  });

  it('заголовок экрана по состоянию', () => {
    expect(reviewTitle({ ...BASE, state: 'low_data', sentCount: 6 })).toBe('Мало данных для вывода: 6 откликов');
    expect(reviewTitle(BASE)).toBe('3 отказа на 21 отклик');
    expect(
      reviewTitle({ ...BASE, firstStep: { kind: 'show_in_resume', requirement: 'Команда от 20', profileFact: 'команда 9', count: 2, total: 3 } }),
    ).toBe('Показать в резюме: Команда от 20');
  });
});
