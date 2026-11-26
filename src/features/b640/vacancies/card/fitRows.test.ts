import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { vacancyFitSentence } from '../../../vacancies/vacancyFitModel';
import { fitBlockState, fitRows, listedRows, sourceLine } from './fitRows';

function req(id: string, text: string, skill = true) {
  return {
    id,
    text,
    sourceQuote: text,
    origin: 'explicit' as const,
    importance: 'high' as const,
    kind: 'experience' as const,
    hard: false,
    stopFactor: false,
    skill,
  };
}

function view(overrides: Partial<VacancyFitView> = {}): VacancyFitView {
  return {
    state: 'ready',
    requirements: [
      req('a', 'Kubernetes'),
      req('b', 'Найм руководителей'),
      req('c', 'English C1'),
      req('d', 'Go'),
    ],
    result: {
      candidateId: 'c',
      vacancyId: 'v',
      algorithmVersion: 'x',
      status: 'assessed',
      calculatedAt: '2026-11-11T09:00:00Z',
      dataState: 'confirmed',
      coveragePercent: 75,
      coverage: { matched: 2, total: 4, unknown: 1, partial: 1 },
      requiredCoverage: { matched: 2, total: 4, percent: 50 },
      reason: 'assessed',
      gates: {} as never,
      assessments: [
        {
          requirementId: 'a',
          status: 'matched',
          evidence: [{ factId: 'f', quote: 'Финтех Лаб · Kubernetes' }],
        },
        {
          requirementId: 'b',
          status: 'partial',
          evidence: [{ factId: 'f', quote: 'нанимали разработчиков' }],
        },
        { requirementId: 'c', status: 'unknown', evidence: [] },
        { requirementId: 'd', status: 'unmatched', evidence: [] },
      ],
    },
    ...overrides,
  } as VacancyFitView;
}

describe('fitRows', () => {
  it('строки с классом статуса, цитатой и признаком «Проверить»', () => {
    const rows = fitRows(view());
    expect(rows.map((row) => row.status)).toEqual(['matched', 'partial', 'unknown', 'unmatched']);
    expect(rows[0]).toMatchObject({
      text: 'Kubernetes',
      evidence: 'Финтех Лаб · Kubernetes',
      canCheck: false,
    });
    expect(rows[1]).toMatchObject({
      evidence: 'частично · нанимали разработчиков',
      canCheck: true,
    });
    expect(rows[2]).toMatchObject({ evidence: 'неизвестно', canCheck: true });
    expect(rows[3]).toMatchObject({ evidence: 'нет в профиле', canCheck: false });
  });

  it('условия (не навыки) в список не попадают', () => {
    const rows = fitRows(
      view({ requirements: [req('a', 'Kubernetes'), { ...req('z', 'Высшее образование', false), kind: 'education' as const }] }),
    );
    expect(rows.map((row) => row.id)).toEqual(['a']);
  });

  it('навык, который следует из опыта, — «есть», как в предложении «Без проверки навыков»', () => {
    const base = view();
    const implied = view({
      requirements: base.requirements.map((item) => ({ ...item, label: item.text })),
      result: { ...base.result!, implied: [{ requirementId: 'b', role: 'VP of Engineering' }] },
    });
    expect(fitRows(implied)[1]).toMatchObject({
      status: 'matched',
      evidence: 'нанимали разработчиков',
      canCheck: false,
    });
    const bare = view({
      result: { ...base.result!, implied: [{ requirementId: 'c', role: 'VP of Engineering' }] },
    });
    expect(fitRows(bare)[2]).toMatchObject({
      status: 'matched',
      evidence: 'следует из опыта: VP of Engineering',
    });
    expect(vacancyFitSentence(implied)).toContain('Найм руководителей');
  });

  it('в строках ровно посчитанное: опыт без метки навыка есть, обязанность — нет', () => {
    const base = view();
    const rows = fitRows(
      view({
        requirements: [req('a', 'Kubernetes'), req('b', 'Опыт найма', false), req('d', 'Вести планёрки')],
        result: { ...base.result!, duties: ['d'] },
      }),
    );
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('пожелание видно после посчитанных и не входит в их число', () => {
    const base = view();
    const wish = view({ result: { ...base.result!, duties: ['d'], wishes: ['d'] } });
    expect(fitRows(wish).map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(listedRows(wish).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(listedRows(wish)[3]).toMatchObject({ evidence: 'желательно', canCheck: false });
    expect(sourceLine(wish, 'hh.ru')).toContain('· 3 требования');
    const duty = view({ result: { ...base.result!, duties: ['d'] } });
    expect(listedRows(duty)).toHaveLength(3);
  });

  it('без оценки требование неизвестно', () => {
    const rows = fitRows(view({ result: undefined }));
    expect(rows.every((row) => row.status === 'unknown')).toBe(true);
  });
});

describe('sourceLine', () => {
  it('строка источника с числом и датой', () => {
    expect(sourceLine(view(), 'hh.ru')).toBe(
      'Требования — из текста вакансии, hh.ru, 11.11 · 4 требования',
    );
  });
});

describe('fitBlockState', () => {
  it('нет ответа и счёт в работе — busy', () => {
    expect(fitBlockState(undefined, false)).toBe('busy');
    expect(fitBlockState(view({ state: 'processing', result: undefined }), false)).toBe('busy');
  });
  it('сбой чтения и failed — err', () => {
    expect(fitBlockState(undefined, true)).toBe('err');
    expect(fitBlockState(view({ state: 'failed', result: undefined }), false)).toBe('err');
    expect(fitBlockState(view({ state: 'not_requested', result: undefined }), false)).toBe('err');
  });
  it('нет профиля — none, процент — ready', () => {
    const none = view({
      result: {
        ...view().result!,
        reason: 'no_eligible_facts',
        status: 'unknown',
        coveragePercent: null,
      },
    });
    expect(fitBlockState(none, false)).toBe('none');
    expect(fitBlockState(view(), false)).toBe('ready');
  });
  it('мало требований — few', () => {
    expect(fitBlockState(view({ state: 'no_requirements', result: undefined }), false)).toBe('few');
  });
});
