import { useState } from 'react';
import { ListChecks } from '@phosphor-icons/react';
import {
  TARIFF_LEVELS,
  type TariffSubscriptionInfo,
  type TariffTierId,
} from './tariffsData';
import { TariffCard } from './TariffCard';
import { TariffComparisonTable } from './TariffComparisonTable';
import { TariffMobileView } from './TariffMobileView';

if (typeof document !== 'undefined') {
  void import('./tariffs.css');
}

export interface CareerTariffsViewProps {
  readonly onOpenCoach?: () => void;
  readonly activeTierId?: TariffTierId;
  readonly initialView?: string;
  readonly subscription?: TariffSubscriptionInfo;
  readonly onSelectTier?: (id: TariffTierId) => void;
  readonly onRequestTier?: (id: TariffTierId) => void;
}

export function CareerTariffsView({
  activeTierId = 'free',
  initialView = 'home',
  subscription,
  onSelectTier,
  onRequestTier,
}: CareerTariffsViewProps) {
  const [compareOpen, setCompareOpen] = useState(false);

  return (
    <section className="career-tariffs" aria-labelledby="tariffs-page-title">
      <div className="career-tariffs-desktop">
        <TariffsDesktopHeader
          onToggleCompare={() => setCompareOpen((prev) => !prev)}
        />
        <div className="career-tariffs-ladder">
          {TARIFF_LEVELS.map((level) => (
            <TariffCard
              key={level.id}
              level={level}
              activeTierId={activeTierId}
              subscription={subscription}
              onSelectTier={onSelectTier}
              onRequestTier={onRequestTier}
            />
          ))}
        </div>
        <TariffComparisonTable defaultOpen={compareOpen} />
      </div>

      <div className="career-tariffs-mobile">
        <TariffMobileView
          activeTierId={activeTierId}
          initialView={initialView}
          subscription={subscription}
          onSelectTier={onSelectTier}
          onRequestTier={onRequestTier}
        />
      </div>
    </section>
  );
}

function TariffsDesktopHeader({ onToggleCompare }: { readonly onToggleCompare: () => void }) {
  return (
    <div className="career-tariffs-head">
      <div className="career-tariffs-head-row">
        <h2 className="career-tariffs-title" id="tariffs-page-title">
          Тарифы
        </h2>
        <button className="career-btn is-sm" type="button" onClick={onToggleCompare}>
          <ListChecks size={16} aria-hidden="true" />
          Сравнить тарифы
        </button>
      </div>
      <p className="career-tariffs-lead">
        Месячная подписка, автопродление, отмена в 1 клик. Перейти можно на любой тариф, а не
        только на следующий. Оплата ещё не включена: напишем, когда откроется.
      </p>
    </div>
  );
}
