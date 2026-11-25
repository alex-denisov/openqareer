import { describe, expect, it } from 'vitest';
import type { QuestionnaireQuestion } from '../../shared/applicationQuestionnaire';
import type { SalaryMarketGroup, SalaryMarketSnapshot } from '../../shared/salaryMarketSnapshot';
import { buildQuestionnaire } from './applicationQuestionnaire';
import { salaryMarketAnswers, type SalaryVacancy } from './salaryMarketAnswer';

const NOW = Date.parse('2026-11-25T12:00:00.000Z');
const bound = (p50: number) => ({ p25: p50, p50, p75: p50, p90: p50 });
const group = (
  currency: string,
  period: SalaryMarketGroup['period'],
  taxBasis: SalaryMarketGroup['taxBasis'],
  low: number,
  high: number,
): SalaryMarketGroup => ({
  currency,
  period,
  taxBasis,
  sampleSize: 20,
  lower: bound(low),
  upper: bound(high),
});
const groups = [
  group('USD', 'year', 'unknown', 120_000, 160_000),
  group('RUR', 'month', 'net', 150_000, 250_000),
];
const snapshot = {
  role: 'product-manager',
  updatedAt: '2026-11-25T04:00:00.000Z',
  salary: { status: 'available', groups },
} as unknown as SalaryMarketSnapshot;
const VACANCY: SalaryVacancy = {
  title: 'Product Manager',
  location: 'United States',
  isRemote: false,
  sourceName: 'Lever',
  observedAt: '2026-11-24T10:00:00.000Z',
};
const ask = (text: string, extra: Partial<QuestionnaireQuestion> = {}): QuestionnaireQuestion => ({
  id: 'q',
  text,
  required: true,
  kind: 'text',
  ...extra,
});
const run = (
  question: QuestionnaireQuestion,
  vacancy: Partial<SalaryVacancy> = {},
  data: SalaryMarketSnapshot | null = snapshot,
) =>
  salaryMarketAnswers(
    [question],
    {
      vacancy: { ...VACANCY, ...vacancy },
      readSnapshot: () => data,
      rates: { date: '2026-11-25', rubPerUnit: { USD: 80, EUR: 100 } },
    },
    NOW,
  )[0];
const own = {
  salary: {
    from: 100_000,
    to: 140_000,
    currency: 'USD',
    period: 'year' as const,
    periodEvidence: { field: 'lever.salaryRange.interval' as const, value: 'per-year-salary' },
  },
};

describe('B788: рыночная зарплата', () => {
  it('сначала вилка вакансии, с источником и датой', () => {
    expect(run(ask('Salary expectations'), own)).toEqual({
      questionId: 'q',
      text: '120 000 USD per year',
      source: 'Вилка вакансии 100 000–140 000 $ в год, Lever, 24.11.2026',
      live: true,
    });
  });

  it('затем рынок роли: источник, выборка и дата названы', () => {
    const answer = run(ask('Salary expectations'));
    expect(answer?.text).toBe('140 000 USD per year');
    expect(answer?.source).toMatch(
      /вакансии с зарплатой в USD, 20 вилок, каталог OpenQareer, 25\.11\.2026/u,
    );
    expect(run(ask('Желаемая зарплата на руки'), { location: 'Россия' })?.text).toBe(
      '200 000 ₽ в месяц на руки',
    );
  });

  it('период и валюта вопроса; числовое поле получает число', () => {
    expect(run(ask('Monthly salary expectation', { numeric: true }), own)?.text).toBe('10000');
    const euro = run(ask('Annual salary expectation in EUR'), own);
    expect(euro?.text).toBe('96 000 EUR per year');
    expect(euro?.source).toContain('курс ЦБ на 25.11.2026');
  });

  it.each([
    ['необязательный вопрос', ask('Salary expectations', { required: false }), {}],
    ['нынешняя зарплата', ask('Current salary'), {}],
    ['согласие с вилкой', ask('Are you comfortable with the salary range?'), {}],
    ['gross у данных без налоговой базы', ask('Gross salary expectation'), {}],
    ['почасовой вопрос без почасовых данных', ask('Hourly salary expectation'), {}],
    ['две валюты', ask('Salary expectations (USD or EUR)'), {}],
    ['страна не названа', ask('Salary expectations'), { location: null }],
    ['уровень без своего среза', ask('Salary expectations'), { title: 'Junior Product Manager' }],
    ['роль не из справочника', ask('Salary expectations'), { title: 'Zzz Qqq' }],
  ])('остаётся кандидату: %s', (_, question, vacancy) =>
    expect(run(question, vacancy)).toBeUndefined(),
  );

  it('без данных и по старым данным цифры нет', () => {
    expect(run(ask('Salary expectations'), {}, null)).toBeUndefined();
    const old = { ...snapshot, updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(run(ask('Salary expectations'), {}, old)).toBeUndefined();
  });

  it('ожидания из профиля и ответ кандидата важнее рынка; стёртое не возвращается', () => {
    const view = (
      salaryFloor: number | undefined,
      answers: { questionId: string; text: string }[],
    ) =>
      buildQuestionnaire({
        vacancyId: 'v',
        state: 'ready',
        formUrl: null,
        questions: [ask('Salary expectations')],
        answers,
        profile: { salaryFloor, salaryCurrency: 'USD' },
        readAt: null,
        submittedAt: null,
        salaryMarket: { vacancy: { ...VACANCY, ...own }, readSnapshot: () => null },
      });
    expect(view(9000, []).answers[0]?.text).toBe('от 9 000 $');
    expect(view(undefined, []).answers[0]?.text).toBe('120 000 USD per year');
    expect(view(undefined, [{ questionId: 'q', text: '99' }]).suggestions).toEqual([]);
    expect(view(undefined, [{ questionId: 'q', text: '' }]).answers).toEqual([]);
  });
});
