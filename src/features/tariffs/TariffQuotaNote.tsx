import {
  QUOTA_PLAN_NAMES,
  formatQuotaNumber,
  type TariffQuotaKey,
  type TariffQuotaStatus,
} from './tariffQuotaApi';
import { useTariffQuotas } from './useTariffQuotas';

export interface TariffQuotaNoteProps {
  readonly quota: TariffQuotaKey;
  /** Меняется после траты квоты — строка перечитывает остаток. */
  readonly refreshKey?: unknown;
}

/** B579: остаток квоты там, где она тратится. Без квот (тестовый аккаунт) — ничего. */
export function TariffQuotaNote({ quota, refreshKey }: TariffQuotaNoteProps) {
  const summary = useTariffQuotas(refreshKey);
  const status =
    summary && !summary.unlimited ? summary.quotas.find((item) => item.key === quota) : undefined;
  if (!status || status.limit === 0) return null;
  return (
    <p className={`career-quota-note${status.remaining === 0 ? ' is-exhausted' : ''}`}>
      {quotaNoteText(status)}
    </p>
  );
}

export function quotaNoteText(status: TariffQuotaStatus): string {
  const counts = `${formatQuotaNumber(status.remaining)} из ${formatQuotaNumber(status.limit)}`;
  if (status.remaining > 0) return `${status.label}: осталось ${counts} в этом месяце`;
  const upgrade = status.upgradePlan
    ? ` Больше — на тарифе ${QUOTA_PLAN_NAMES[status.upgradePlan]}.`
    : '';
  return `${status.label}: квота месяца исчерпана.${upgrade}`;
}
