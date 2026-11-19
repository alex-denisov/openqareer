import { APPLICATION_STAGES, type ApplicationStage } from '../../shared/applicationStage';
import type {
  B640OfferDeadline,
  B640OfferDecision,
  B640OfferView,
  B640ResponseSummary,
  B640StageCounts,
} from '../../shared/b640Offers';
import type { ApplicationOfferTerms } from '../data/sqliteApplicationOfferRepository';

const DAY_MS = 86_400_000;
const SOON_DAYS = 2;

/** Сумма на руки: брутто за вычетом введённого кандидатом налога, до целых. */
export function netFromGross(amount: number | null, taxPercent: number | null): number | null {
  if (amount === null || taxPercent === null) return null;
  return Math.round(amount * (1 - taxPercent / 100));
}

function utcDay(value: string): number | null {
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / DAY_MS);
}

/** Дни до срока ответа по календарным суткам UTC и состояние срока. */
export function offerDeadline(
  respondBy: string | null,
  now: Date,
): { daysLeft: number | null; deadline: B640OfferDeadline | null } {
  const day = respondBy === null ? null : utcDay(respondBy);
  if (day === null) return { daysLeft: null, deadline: null };
  const daysLeft = day - Math.floor(now.getTime() / DAY_MS);
  const deadline: B640OfferDeadline =
    daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'today' : daysLeft <= SOON_DAYS ? 'soon' : 'later';
  return { daysLeft, deadline };
}

export interface OfferChoice {
  readonly taxPercent: number | null;
  readonly decision: B640OfferDecision | null;
  readonly decidedAt: string | null;
}

export interface OfferViewInput {
  readonly applicationId: string;
  readonly terms: ApplicationOfferTerms;
  readonly respondBy: string | null;
  readonly choice: OfferChoice | null;
  readonly now: Date;
}

export function buildOfferView(input: OfferViewInput): B640OfferView {
  const { terms, choice } = input;
  const amount = terms.baseSalary ?? null;
  const taxPercent = choice?.taxPercent ?? null;
  return {
    applicationId: input.applicationId,
    gross: { amount, period: terms.salaryPeriod ?? null, currency: terms.currency ?? null },
    taxPercent,
    net: netFromGross(amount, taxPercent),
    respondBy: input.respondBy,
    ...offerDeadline(input.respondBy, input.now),
    decision: choice?.decision ?? null,
    decidedAt: choice?.decidedAt ?? null,
  };
}

const emptyCounts = (): Record<ApplicationStage, number> =>
  Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, 0])) as Record<
    ApplicationStage,
    number
  >;

/** Отклики по текущему этапу: все, автоотклики и ручные отдельно. */
export function summarizeResponses(
  applications: readonly { readonly id: string; readonly stage: ApplicationStage }[],
  autoIds: ReadonlySet<string>,
): B640ResponseSummary {
  const all = emptyCounts();
  const auto = emptyCounts();
  const manual = emptyCounts();
  const autoApplicationIds: string[] = [];
  for (const { id, stage } of applications) {
    all[stage] += 1;
    if (autoIds.has(id)) {
      auto[stage] += 1;
      autoApplicationIds.push(id);
    } else manual[stage] += 1;
  }
  const frozen = (counts: Record<ApplicationStage, number>): B640StageCounts => counts;
  return {
    counts: { all: frozen(all), auto: frozen(auto), manual: frozen(manual) },
    autoApplicationIds,
  };
}
