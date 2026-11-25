import type { TariffQuotaPlanId } from '../../tariffs/tariffQuotaApi';
import { payUrl, TARIFF_TIERS } from '../account/billingModel';
import { Icon, Link } from '../kit';

/** t04: пробных интервью на тарифе нет или они закончились — переход на тариф, где они есть. */
export function TrainingUpgrade({ planId }: { readonly planId: TariffQuotaPlanId }) {
  const tier = TARIFF_TIERS.find((item) => item.id === planId);
  if (!tier || tier.id === 'free') return null;
  return (
    <section className="pm-block" aria-label="Пробные интервью">
      <div className="pm-hint">
        <span>
          Пробные интервью — с {tier.name} · <b className="num">{tier.interviews}</b> в месяц
        </span>
        <div className="actions">
          <Link className="btn is-primary" to={payUrl(tier.id)}>
            <Icon name="wallet" />
            Перейти на {tier.name}
          </Link>
        </div>
      </div>
    </section>
  );
}
