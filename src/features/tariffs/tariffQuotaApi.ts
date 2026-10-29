import { apiFetch, readData } from '../coach/apiClient';

/** B579: месячные квоты тарифа; сервер считает их по периоду подписки. */
export type TariffQuotaKey =
  'applications' | 'auto_applications' | 'coach_turns' | 'interview_trainings' | 'linkedin_drafts';
export type TariffQuotaPlanId = 'free' | 'basic' | 'pro' | 'max';

export interface TariffQuotaStatus {
  readonly key: TariffQuotaKey;
  readonly label: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
  readonly upgradePlan: TariffQuotaPlanId | null;
}

export interface TariffQuotaSummary {
  readonly plan: TariffQuotaPlanId | null;
  readonly unlimited: boolean;
  readonly period: { readonly startedAt: string; readonly endsAt: string } | null;
  readonly quotas: readonly TariffQuotaStatus[];
  readonly fitPercentLimit: number | null;
}

export async function fetchTariffQuotas(): Promise<TariffQuotaSummary> {
  return readData<TariffQuotaSummary>(await apiFetch('/api/v1/candidate/billing/quotas'));
}

export const QUOTA_PLAN_NAMES: Readonly<Record<TariffQuotaPlanId, string>> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  max: 'Max',
};

/** Счётчики в тексте — с неразрывным пробелом тысяч: «3 000». */
export function formatQuotaNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}
