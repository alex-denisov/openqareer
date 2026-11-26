import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { coachVerdict } from './coachVerdict';

type Status = 'matched' | 'partial' | 'unmatched' | 'unknown';

interface Row {
  readonly id: string;
  readonly text: string;
  readonly status: Status;
  readonly hard?: boolean;
  readonly importance?: 'high' | 'medium' | 'low';
}

function view(rows: readonly Row[], percent: number): VacancyFitView {
  const matched = rows.filter((row) => row.status === 'matched').length;
  return {
    state: 'ready',
    requirements: rows.map((row) => ({
      id: row.id,
      text: row.text,
      sourceQuote: row.text,
      origin: 'explicit',
      importance: row.importance ?? 'medium',
      kind: 'experience',
      hard: row.hard ?? false,
      stopFactor: false,
      skill: true,
    })),
    result: {
      candidateId: 'c',
      vacancyId: 'v',
      algorithmVersion: 'x',
      status: 'assessed',
      calculatedAt: '2026-11-11T09:00:00Z',
      dataState: 'confirmed',
      coveragePercent: percent,
      coverage: { matched, total: rows.length, unknown: 0 },
      requiredCoverage: { matched, total: rows.length, percent },
      reason: 'assessed',
      gates: {},
      assessments: rows.map((row) => ({
        requirementId: row.id,
        status: row.status,
        evidence: row.status === 'unmatched' ? [] : [{ factId: 'f', quote: 'q' }],
      })),
    },
  } as unknown as VacancyFitView;
}

const LADOGA: readonly Row[] = [
  { id: 'a', text: 'Kotlin', status: 'matched' },
  { id: 'b', text: 'Платёжные системы', status: 'matched', hard: true },
  { id: 'c', text: 'Микросервисы', status: 'matched', importance: 'high' },
  { id: 'd', text: 'PostgreSQL', status: 'matched' },
  { id: 'e', text: 'CI/CD', status: 'matched' },
  { id: 'f', text: 'Наставничество', status: 'matched' },
  { id: 'g', text: 'Найм руководителей', status: 'unmatched' },
];

describe('coachVerdict: «Вывод консультанта» по требованиям (a02d)', () => {
  it('verdict, the strongest match, and the question to prepare for, as in the mockup', () => {
    expect(coachVerdict(view(LADOGA, 86))).toBe(
      'Стоит откликаться: 6 из 7 требований есть в профиле, самое сильное — «Платёжные системы». ' +
        'Спросят про «Найм руководителей» — в профиле этого нет, готовьте честный ответ.',
    );
  });

  it('a middle percent is a reservation, a low one advises against', () => {
    expect(coachVerdict(view(LADOGA, 50))).toMatch(/^Можно откликаться с оговоркой: 6 из 7/u);
    expect(coachVerdict(view(LADOGA, 30))).toMatch(/^Скорее не стоит: 6 из 7/u);
  });

  it('nothing missing: the partial one is the question; nothing partial either: no question', () => {
    const partial = LADOGA.map((row) =>
      row.id === 'g' ? { ...row, status: 'partial' as const } : row,
    );
    expect(coachVerdict(view(partial, 90))).toMatch(
      /Спросят про «Найм руководителей» — в профиле это есть частично, подготовьте пример\.$/u,
    );
    const all = LADOGA.map((row) => ({ ...row, status: 'matched' as const }));
    expect(coachVerdict(view(all, 100))).toBe(
      'Стоит откликаться: 7 из 7 требований есть в профиле, самое сильное — «Платёжные системы».',
    );
  });

  it('a mandatory missing requirement comes before an ordinary one', () => {
    const rows: Row[] = [
      ...LADOGA.slice(0, 5),
      { id: 'x', text: 'Docker', status: 'unmatched' },
      { id: 'y', text: 'Английский B2', status: 'unmatched', hard: true },
    ];
    expect(coachVerdict(view(rows, 70))).toContain('Спросят про «Английский B2»');
  });

  it('no match at all: no «самое сильное»', () => {
    const none = LADOGA.map((row) => ({ ...row, status: 'unmatched' as const }));
    expect(coachVerdict(view(none, 0))).toMatch(
      /^Скорее не стоит: 0 из 7 требований есть в профиле\. /u,
    );
  });

  it('no percent: no verdict', () => {
    expect(coachVerdict(undefined)).toBeNull();
    expect(coachVerdict({ ...view(LADOGA, 86), state: 'processing' })).toBeNull();
  });
});
