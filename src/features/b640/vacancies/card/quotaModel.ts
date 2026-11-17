import type { B640ApplicationQuota } from '../../../../../shared/b640Vacancies';
import { pluralRu } from '../format';

/** Остаток показываем, когда откликов осталось не больше трёх (порога в механике нет — решение исполнителя). */
export const QUOTA_LINE_THRESHOLD = 3;

const NEXT_PLAN: Readonly<Record<string, string>> = { free: 'Basic', basic: 'Pro', pro: 'Max' };

export interface QuotaLineView {
  readonly text: string;
  readonly link: string;
}

/** Строка «Осталось N отклика · Перейти на <тариф>»; нет лимита или остатка выше порога — `null`. */
export function quotaLine(quota: B640ApplicationQuota | null): QuotaLineView | null {
  if (!quota || quota.limit === null || quota.remaining === null) return null;
  const left = quota.remaining;
  if (left < 0 || left > QUOTA_LINE_THRESHOLD) return null;
  const next = quota.plan ? NEXT_PLAN[quota.plan] : undefined;
  return {
    text: `Осталось ${left} ${pluralRu(left, 'отклик', 'отклика', 'откликов')}`,
    link: next ? `Перейти на ${next}` : 'Тарифы',
  };
}
