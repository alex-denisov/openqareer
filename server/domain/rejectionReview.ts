import type { ApplicationStage } from '../../shared/applicationStage';
import {
  REJECTION_REVIEW_LIMIT,
  REJECTION_REVIEW_MIN_SAMPLE,
  type RejectionCandidateReason,
  type RejectionGuess,
  type RejectionRecommendation,
  type RejectionReview,
  type RejectionReviewItem,
} from '../../shared/rejectionReview';
import type { VacancyFitView } from '../../shared/vacancyFit';
import type { VacancyRequirement } from './vacancyRequirements';

const IMPORTANCE_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const FACT_MAX_LENGTH = 240;

/** Чем меньше, тем вероятнее причина отказа: обязательное и непокрытое — первым. */
function weight(requirement: VacancyRequirement, unmatched: boolean): number {
  const must = requirement.stopFactor ? 0 : requirement.hard ? 1 : 2;
  return must * 100 + (unmatched ? 0 : 10) + IMPORTANCE_RANK[requirement.importance];
}

function clip(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > FACT_MAX_LENGTH ? `${flat.slice(0, FACT_MAX_LENGTH - 1)}…` : flat;
}

/**
 * «Вероятно, не хватило» по готовой сверке вакансии с профилем. Берётся одно требование:
 * непокрытое или покрытое частично. Сверки нет или пробелов нет — догадки нет.
 */
export function guessFromFit(view: VacancyFitView): RejectionGuess | null {
  if (view.state !== 'ready' && view.state !== 'refreshing') return null;
  const assessments = view.result?.assessments ?? [];
  const gaps = assessments
    // Частичное покрытие без цитаты из профиля нечем подтвердить: такой пробел не называем.
    .filter(
      (item) =>
        item.status === 'unmatched' ||
        (item.status === 'partial' && item.evidence.some((evidence) => evidence.quote.trim())),
    )
    .flatMap((item) => {
      const requirement = view.requirements.find((entry) => entry.id === item.requirementId);
      return requirement ? [{ requirement, item }] : [];
    })
    .sort(
      (a, b) =>
        weight(a.requirement, a.item.status === 'unmatched') -
        weight(b.requirement, b.item.status === 'unmatched'),
    );
  const top = gaps[0];
  if (!top) return null;
  const fact = top.item.evidence.map((evidence) => evidence.quote.trim()).find(Boolean);
  return {
    requirement: clip(top.requirement.label || top.requirement.text),
    quote: clip(top.requirement.sourceQuote || top.requirement.text),
    profileFact: top.item.status === 'partial' && fact ? clip(fact) : null,
  };
}

export interface RejectionReviewApplication {
  readonly id: string;
  readonly stage: ApplicationStage;
  readonly title: string;
  readonly company: string | null;
  readonly stageChangedAt: string;
}

export interface RejectionReviewInput {
  readonly applications: readonly RejectionReviewApplication[];
  readonly guesses: ReadonlyMap<string, RejectionGuess | null>;
  readonly reasons: ReadonlyMap<string, RejectionCandidateReason>;
  readonly helped: boolean | null;
}

/** Отказы, которые разбираем: свежие первыми, не больше лимита. */
export function rejectedForReview(
  applications: readonly RejectionReviewApplication[],
): readonly RejectionReviewApplication[] {
  return applications
    .filter((application) => application.stage === 'rejected')
    .sort((a, b) => b.stageChangedAt.localeCompare(a.stageChangedAt))
    .slice(0, REJECTION_REVIEW_LIMIT);
}

function recommendations(items: readonly RejectionReviewItem[]): readonly RejectionRecommendation[] {
  const guessed = items.flatMap((item) => (item.guess ? [item.guess] : []));
  const groups = new Map<string, { guess: RejectionGuess; count: number }>();
  for (const guess of guessed) {
    // Частично покрытое и неподтверждённое — разные советы, даже при одном требовании.
    const key = `${guess.profileFact ? 'partial' : 'none'}:${guess.requirement.toLocaleLowerCase('ru')}`;
    const known = groups.get(key);
    groups.set(key, {
      guess: known?.guess ?? guess,
      count: (known?.count ?? 0) + 1,
    });
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ guess, count }) => ({
      kind: guess.profileFact ? ('show_in_resume' as const) : ('match_vacancies' as const),
      requirement: guess.requirement,
      profileFact: guess.profileFact,
      count,
      total: items.length,
    }));
}

/** Собирает ответ экрана «Разбор отказов». Рекомендации стоят только на догадках из сверки. */
export function buildRejectionReview(input: RejectionReviewInput): RejectionReview {
  const sent = input.applications.filter((application) => application.stage !== 'saved');
  const rejected = sent.filter((application) => application.stage === 'rejected');
  const rejections: RejectionReviewItem[] = rejectedForReview(sent).map((application) => ({
    applicationId: application.id,
    title: application.title,
    company: application.company,
    rejectedAt: application.stageChangedAt,
    guess: input.guesses.get(application.id) ?? null,
    candidateReason: input.reasons.get(application.id) ?? null,
  }));
  const base = {
    sentCount: sent.length,
    threshold: REJECTION_REVIEW_MIN_SAMPLE,
    rejectedCount: rejected.length,
    rejections,
    helped: input.helped,
  };
  if (sent.length < REJECTION_REVIEW_MIN_SAMPLE) {
    const waiting = sent.filter((application) => application.stage === 'applied').length;
    return {
      ...base,
      state: 'low_data',
      firstStep:
        waiting > 0
          ? { kind: 'update_statuses', requirement: null, profileFact: null, count: waiting, total: sent.length }
          : null,
      recommendations: [],
    };
  }
  const [firstStep = null, ...rest] = recommendations(rejections);
  return { ...base, state: 'ready', firstStep, recommendations: rest };
}
