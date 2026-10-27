import type { CoachTurnInput, CoachTurnResult } from './coach';

/**
 * Консультант ответил «Нижняя граница поиска — 800 000 ₽», а в условиях осталось
 * «от 600 000 ₽» (приёмка 28.10): модель назвала изменение, но не вернула
 * career.conditions.update. Условие меняется только карточкой «Применить /
 * Не сейчас», поэтому сервер сам добавляет её, когда кандидат прямо назвал порог.
 */

const SALARY_WORD = /зарплат|оклад|границ|доход|на руки/iu;
const AMOUNT = /(\d{1,3}(?:[\s\u00a0]\d{3})+|\d{4,9}|\d{1,4})\s*(тыс)?/giu;
const MIN_FLOOR = 10_000;
const MEASURE_AFTER_DAYS = 14;

type Proposal = CoachTurnResult['actionProposals'][number];

/** Порог в рублях из последней реплики кандидата, если он назван числом. */
export function requestedSalaryFloor(text: string): number | undefined {
  if (!SALARY_WORD.test(text)) return undefined;
  const amounts = [...text.matchAll(AMOUNT)].map(([, digits, unit]) => {
    const value = Number(digits.replace(/[\s\u00a0]/gu, ''));
    return unit ? value * 1_000 : value;
  });
  return amounts.find((value) => value >= MIN_FLOOR);
}

function lastCandidateMessage(input: CoachTurnInput): string {
  return [...input.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
}

function proposesFloor(proposals: readonly Proposal[]): boolean {
  return proposals.some(
    (proposal) =>
      proposal.kind === 'career.conditions.update' && Boolean(proposal.careerChange?.salaryFloorRubles),
  );
}

function floorProposal(floor: number, now: Date): Proposal {
  const measureAfter = new Date(now.getTime() + MEASURE_AFTER_DAYS * 86_400_000);
  const amount = floor.toLocaleString('ru-RU');
  return {
    kind: 'career.conditions.update',
    objective: `Поднять нижнюю границу зарплаты в условиях поиска до ${amount} ₽ на руки.`,
    evidenceRefs: ['candidate:message'],
    acceptanceCriteria: [`В условиях «Карьеры» стоит «Зарплата от ${amount} ₽».`],
    expectedSignal: 'Подборка пересчитается по новому порогу.',
    measureAfter: measureAfter.toISOString().slice(0, 10),
    risk: 'candidate_data_write',
    resumeRevision: null,
    careerChange: {
      roleTitle: null,
      locations: null,
      salaryFloorRubles: floor,
      formats: null,
      relocation: null,
      stopCompanies: null,
    },
  };
}

export function withSalaryFloorProposal(
  result: CoachTurnResult,
  input: CoachTurnInput,
  now: Date = new Date(),
): CoachTurnResult {
  const context = input.careerContext;
  if (!context || proposesFloor(result.actionProposals)) return result;
  const floor = requestedSalaryFloor(lastCandidateMessage(input));
  if (floor === undefined || floor === context.salaryFloorRubles) return result;
  return { ...result, actionProposals: [...result.actionProposals, floorProposal(floor, now)] };
}
