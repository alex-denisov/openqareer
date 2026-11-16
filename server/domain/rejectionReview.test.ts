import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../shared/vacancyFit';
import type { VacancyRequirement } from './vacancyRequirements';
import {
  buildRejectionReview,
  guessFromFit,
  type RejectionReviewApplication,
} from './rejectionReview';

function requirement(id: string, text: string, extra: Partial<VacancyRequirement> = {}): VacancyRequirement {
  return {
    id,
    text,
    sourceQuote: `цитата: ${text}`,
    origin: 'explicit',
    importance: 'medium',
    kind: 'experience',
    hard: false,
    stopFactor: false,
    ...extra,
  };
}

function view(
  requirements: readonly VacancyRequirement[],
  assessments: readonly { id: string; status: 'matched' | 'partial' | 'unmatched' | 'unknown'; quotes?: readonly string[] }[],
  state: VacancyFitView['state'] = 'ready',
): VacancyFitView {
  return {
    state,
    requirements,
    result: {
      assessments: assessments.map((item) => ({
        requirementId: item.id,
        status: item.status,
        evidence: (item.quotes ?? []).map((quote, index) => ({ factId: `f${index}`, quote })),
      })),
    } as unknown as VacancyFitView['result'],
  };
}

describe('B679: догадка об отказе', () => {
  it('берёт непокрытое требование с цитатой вакансии и фактом профиля', () => {
    const guess = guessFromFit(
      view(
        [requirement('r1', 'Python'), requirement('r2', 'Команда от 20 человек', { hard: true })],
        [
          { id: 'r1', status: 'matched', quotes: ['пишу на Python'] },
          { id: 'r2', status: 'partial', quotes: ['руководил командой из 9 человек'] },
        ],
      ),
    );
    expect(guess).toEqual({
      requirement: 'Команда от 20 человек',
      quote: 'цитата: Команда от 20 человек',
      profileFact: 'руководил командой из 9 человек',
    });
  });

  it('обязательное непокрытое важнее частично покрытого', () => {
    const guess = guessFromFit(
      view(
        [
          requirement('r1', 'Английский B2', { importance: 'low' }),
          requirement('r2', 'Опыт в брокерских системах', { stopFactor: true }),
          requirement('r3', 'Команда от 20', { hard: true }),
        ],
        [
          { id: 'r1', status: 'unmatched' },
          { id: 'r2', status: 'unmatched' },
          { id: 'r3', status: 'partial', quotes: ['команда 9'] },
        ],
      ),
    );
    expect(guess?.requirement).toBe('Опыт в брокерских системах');
    expect(guess?.profileFact).toBeNull();
  });

  it('без готовой сверки и без пробелов догадки нет', () => {
    expect(guessFromFit(view([requirement('r1', 'Python')], [], 'processing'))).toBeNull();
    expect(guessFromFit({ state: 'ready', requirements: [] })).toBeNull();
    expect(
      guessFromFit(view([requirement('r1', 'Python')], [{ id: 'r1', status: 'matched' }])),
    ).toBeNull();
    expect(
      guessFromFit(view([requirement('r1', 'Python')], [{ id: 'r1', status: 'unknown' }])),
    ).toBeNull();
  });
});

function sent(id: string, stage: RejectionReviewApplication['stage'], changedAt = '2026-11-09T10:00:00.000Z'): RejectionReviewApplication {
  return { id, stage, title: `Роль ${id}`, company: 'Компания', stageChangedAt: changedAt };
}

const TEAM = { requirement: 'Команда от 20 человек', quote: 'команда от 20', profileFact: 'команда 9' };
const BROKER = { requirement: 'Опыт в брокерских системах', quote: 'брокерские системы', profileFact: null };

describe('B679: разбор отказов', () => {
  it('мало данных: отказы показаны, выводов нет', () => {
    const review = buildRejectionReview({
      applications: [sent('a', 'rejected'), sent('b', 'applied'), sent('c', 'saved')],
      guesses: new Map([['a', TEAM]]),
      reasons: new Map(),
      helped: null,
    });
    expect(review.state).toBe('low_data');
    expect(review.sentCount).toBe(2);
    expect(review.rejectedCount).toBe(1);
    expect(review.rejections[0]).toMatchObject({ applicationId: 'a', guess: TEAM, candidateReason: null });
    expect(review.firstStep).toEqual({ kind: 'update_statuses', requirement: null, profileFact: null, count: 1, total: 2 });
    expect(review.recommendations).toEqual([]);
  });

  it('достаточно данных: первым идёт самое частое требование с фактом профиля', () => {
    const applications = [
      sent('r1', 'rejected', '2026-11-09T10:00:00.000Z'),
      sent('r2', 'rejected', '2026-10-29T10:00:00.000Z'),
      sent('r3', 'rejected', '2026-10-21T10:00:00.000Z'),
      ...Array.from({ length: 18 }, (_, index) => sent(`s${index}`, 'applied')),
    ];
    const review = buildRejectionReview({
      applications,
      guesses: new Map([['r1', TEAM], ['r2', TEAM], ['r3', BROKER]]),
      reasons: new Map([['r2', { reason: 'level', note: null, recordedAt: '2026-10-30T00:00:00.000Z' }]]),
      helped: true,
    });
    expect(review.state).toBe('ready');
    expect(review.rejections.map((item) => item.applicationId)).toEqual(['r1', 'r2', 'r3']);
    expect(review.rejections[1].candidateReason?.reason).toBe('level');
    expect(review.firstStep).toEqual({
      kind: 'show_in_resume', requirement: TEAM.requirement, profileFact: 'команда 9', count: 2, total: 3,
    });
    expect(review.recommendations).toEqual([
      { kind: 'match_vacancies', requirement: BROKER.requirement, profileFact: null, count: 1, total: 3 },
    ]);
    expect(review.helped).toBe(true);
  });

  it('без догадок рекомендаций нет: совет не выдумывается', () => {
    const applications = [
      sent('r1', 'rejected'),
      ...Array.from({ length: 20 }, (_, index) => sent(`s${index}`, 'responded')),
    ];
    const review = buildRejectionReview({ applications, guesses: new Map(), reasons: new Map(), helped: null });
    expect(review.state).toBe('ready');
    expect(review.firstStep).toBeNull();
    expect(review.recommendations).toEqual([]);
  });
});
