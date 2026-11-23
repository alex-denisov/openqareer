import { TARIFF_QUOTAS, type QuotaPlanId } from './tariffQuotas';

export type LinkedinDraftKind = 'post' | 'comment';

/** Старые названия тарифов в users.subscription_tier. */
const LEGACY_PLANS: Readonly<Record<string, QuotaPlanId>> = {
  executive: 'max',
  enterprise: 'max',
};

/**
 * B778: черновики LinkedIn в день — ровно то, что обещает страница тарифов
 * (src/features/tariffs/tariffTypes.ts): Pro — 3 комментария, Executive/Max — 5 комментариев
 * и 2 поста; Free/Basic — ничего. Сверх дня действует месячная квота `linkedin_drafts`.
 */
export const LINKEDIN_DRAFTS_PER_DAY: Readonly<
  Record<QuotaPlanId, Readonly<Record<LinkedinDraftKind, number>>>
> = {
  free: { comment: 0, post: 0 },
  basic: { comment: 0, post: 0 },
  pro: { comment: 3, post: 0 },
  max: { comment: 5, post: 2 },
};

/** Тариф квот по названию из подписки или аккаунта; неизвестное — Free. */
export function draftQuotaPlan(tier: string): QuotaPlanId {
  if (Object.hasOwn(TARIFF_QUOTAS, tier)) return tier as QuotaPlanId;
  return Object.hasOwn(LEGACY_PLANS, tier) ? LEGACY_PLANS[tier]! : 'free';
}

/** Сколько черновиков этого вида можно получить за день; 0 — вида нет на тарифе. */
export function linkedinDraftsPerDay(tier: string, kind: LinkedinDraftKind): number {
  const plan = draftQuotaPlan(tier);
  if (TARIFF_QUOTAS[plan].linkedin_drafts <= 0) return 0;
  return LINKEDIN_DRAFTS_PER_DAY[plan][kind];
}
