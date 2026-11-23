import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { coachVerdict, fitBlockState, fitRows, requirementsLabel, sourceLine } from './fitRows';

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
      view({ requirements: [req('a', 'Kubernetes'), req('z', 'Высшее образование', false)] }),
    );
    expect(rows.map((row) => row.id)).toEqual(['a']);
  });

  it('без оценки требование неизвестно', () => {
    const rows = fitRows(view({ result: undefined }));
    expect(rows.every((row) => row.status === 'unknown')).toBe(true);
  });
});

describe('requirementsLabel и sourceLine', () => {
  it('«N из M есть в профиле» по покрытию', () => {
    expect(requirementsLabel(view())).toBe('Требования: 2 из 4 есть в профиле');
  });
  it('без профиля — «Требования из текста вакансии · N»', () => {
    const none = view({
      result: { ...view().result!, reason: 'no_eligible_facts', status: 'unknown' },
    });
    expect(requirementsLabel(none)).toBe('Требования из текста вакансии · 4');
  });
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

describe('coachVerdict: «Вывод консультанта» на шаге «Отклик» (a02d)', () => {
  it('сколько требований есть в профиле и каких нет', () => {
    const text = coachVerdict(view());
    expect(text).toContain('2 из 4 требований вакансии есть в профиле.');
    expect(text).toMatch(/Нет в профиле: Go\.$/u);
  });

  it('без процента вывода нет: блок не показывается', () => {
    expect(coachVerdict(undefined)).toBeNull();
    expect(coachVerdict(view({ state: 'processing', result: undefined }))).toBeNull();
  });

  it('все требования есть — без строки «Нет в профиле»', () => {
    const all = view();
    const matched = {
      ...all,
      result: {
        ...all.result!,
        assessments: all.result!.assessments.map((item) => ({
          ...item,
          status: 'matched' as const,
        })),
      },
    };
    expect(coachVerdict(matched)).not.toContain('Нет в профиле');
  });
});
