import { fetchTariffQuotas, type TariffQuotaStatus } from '../../../tariffs/tariffQuotaApi';

/** Остаток пробных интервью по тарифу; `null` — безлимит или счётчик не прочитался. */
export async function trainingQuota(): Promise<TariffQuotaStatus | null> {
  try {
    const summary = await fetchTariffQuotas();
    if (summary.unlimited) return null;
    return summary.quotas.find((quota) => quota.key === 'interview_trainings') ?? null;
  } catch {
    // Счётчик — подсказка: без него экран работает.
    return null;
  }
}
