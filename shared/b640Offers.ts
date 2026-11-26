import type { ApplicationStage } from './applicationStage';

/** B680: решение по офферу; сам статус кандидата и этап отклика им не меняются. */
export const B640_OFFER_DECISIONS = ['accepted', 'declined'] as const;
export type B640OfferDecision = (typeof B640_OFFER_DECISIONS)[number];

export const B640_TAX_PERCENT_MAX = 60;

export type B640OfferDeadline = 'overdue' | 'today' | 'soon' | 'later';

export interface B640OfferView {
  readonly applicationId: string;
  readonly gross: {
    readonly amount: number | null;
    readonly period: 'month' | 'year' | null;
    readonly currency: string | null;
  };
  /** Налог, который ввёл кандидат; `null` — не вводил. */
  readonly taxPercent: number | null;
  /** Сумма на руки за тот же период, что и `gross`; `null`, пока нет суммы или налога. */
  readonly net: number | null;
  readonly respondBy: string | null;
  readonly daysLeft: number | null;
  readonly deadline: B640OfferDeadline | null;
  readonly decision: B640OfferDecision | null;
  readonly decidedAt: string | null;
}

export interface B640OfferDecisionResult {
  readonly offer: B640OfferView;
  /** Предложить кандидату статус «Работаю»; применяет его клиент через PUT /candidate/status. */
  readonly proposeStatus: 'working' | null;
}

export type B640StageCounts = Readonly<Record<ApplicationStage, number>>;

export interface B640ResponseSummary {
  readonly counts: {
    readonly all: B640StageCounts;
    readonly auto: B640StageCounts;
    readonly manual: B640StageCounts;
  };
  readonly autoApplicationIds: readonly string[];
  /** Отклики с одобренным письмом: черновик показывает то же, что экран письма (B645). */
  readonly approvedLetterIds: readonly string[];
}
