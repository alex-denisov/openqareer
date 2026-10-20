import { useState, type ReactNode } from 'react';
import { ProTrialPanel } from './ProTrialPanel';
import { ListChecks } from '@phosphor-icons/react';
import type { CandidateBillingSummary } from '../shell/candidateBillingApi';
import { TARIFF_LEVELS, type TariffSubscriptionInfo, type TariffTierId } from './tariffsData';
import { TariffCard } from './TariffCard';
import { TariffComparisonTable } from './TariffComparisonTable';
import { TariffMobileView } from './TariffMobileView';
import { PaywallModal } from './PaywallModal';
import type { TariffUpgradeContext } from './TariffUpgradeFlow';

if (typeof document !== 'undefined') {
  void import('./tariffs.css');
}

export interface CareerTariffsViewProps {
  readonly onOpenCoach?: () => void;
  readonly activeTierId?: TariffTierId;
  readonly initialView?: string;
  readonly subscription?: TariffSubscriptionInfo;
  readonly billingSummary?: CandidateBillingSummary | null;
  readonly onSummaryChanged?: (summary: CandidateBillingSummary) => void;
  readonly billingPanel?: ReactNode;
  readonly externalUpgradeContext?: TariffUpgradeContext | null;
  readonly onCloseExternalUpgrade?: () => void;
  readonly onSelectTier?: (id: TariffTierId) => void;
  readonly onRequestTier?: (id: TariffTierId) => void;
}

export function CareerTariffsView({
  activeTierId = 'free',
  initialView = 'home',
  subscription,
  billingSummary,
  onSummaryChanged,
  billingPanel,
  externalUpgradeContext,
  onCloseExternalUpgrade,
  onSelectTier,
  onRequestTier,
}: CareerTariffsViewProps) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [mobileCompareRevision, setMobileCompareRevision] = useState(0);
  const activeTier = billingSummary ? tierForPlan(billingSummary.currentPlan) : activeTierId;
  const upgrade = useTariffUpgradeCallbacks(activeTier, onSelectTier, onRequestTier);
  const compare = () => {
    setCompareOpen(true);
    setMobileCompareRevision((revision) => revision + 1);
  };

  return (
    <TariffsViewFrame
      activeTier={activeTier}
      initialView={initialView}
      subscription={subscription}
      billingSummary={billingSummary}
      billingPanel={billingPanel}
      externalUpgradeContext={externalUpgradeContext}
      onCloseExternalUpgrade={onCloseExternalUpgrade}
      compareOpen={compareOpen}
      mobileCompareRevision={mobileCompareRevision}
      upgradeContext={upgrade.context}
      onSelectTier={upgrade.selectTier}
      onRequestTier={upgrade.requestTier}
      onCompare={compare}
      onCloseUpgrade={upgrade.close}
      onNavigateToCompare={compare}
      onSummaryChanged={onSummaryChanged}
    />
  );
}

function useTariffUpgradeCallbacks(
  activeTier: TariffTierId,
  onSelectTier?: (id: TariffTierId) => void,
  onRequestTier?: (id: TariffTierId) => void,
) {
  const [context, setContext] = useState<TariffUpgradeContext | null>(null);
  const selectTier = (id: TariffTierId) => {
    if (id === 'free') {
      onSelectTier?.(id);
      return;
    }
    const next = upgradeContextForTier(id);
    if (!next) {
      onSelectTier?.(id);
      return;
    }
    const targetRank = TARIFF_LEVELS.findIndex((level) => level.id === id);
    const activeRank = TARIFF_LEVELS.findIndex((level) => level.id === activeTier);
    if (targetRank < activeRank && next.kind === 'plan') {
      setContext({ kind: 'plan-change-unavailable', planId: next.planId });
      return;
    }
    setContext(next);
  };
  const requestTier = (id: TariffTierId) => {
    if (id === 'exec') setContext({ kind: 'executive' });
    else onRequestTier?.(id);
  };
  const close = () => setContext(null);
  return { context, selectTier, requestTier, close };
}

interface TariffsViewFrameProps {
  readonly activeTier: TariffTierId;
  readonly initialView: string;
  readonly subscription?: TariffSubscriptionInfo;
  readonly billingSummary?: CandidateBillingSummary | null;
  readonly billingPanel?: ReactNode;
  readonly externalUpgradeContext?: TariffUpgradeContext | null;
  readonly onCloseExternalUpgrade?: () => void;
  readonly compareOpen: boolean;
  readonly mobileCompareRevision: number;
  readonly upgradeContext: TariffUpgradeContext | null;
  readonly onSelectTier: (id: TariffTierId) => void;
  readonly onRequestTier: (id: TariffTierId) => void;
  readonly onCompare: () => void;
  readonly onCloseUpgrade: () => void;
  readonly onNavigateToCompare: () => void;
  readonly onSummaryChanged?: (summary: CandidateBillingSummary) => void;
}

function TariffsViewFrame(props: TariffsViewFrameProps) {
  return (
    <section className="career-tariffs" aria-labelledby="tariffs-page-title">
      <ProTrialPanel
        key={props.billingSummary?.currentPlan ?? props.activeTier}
        onSummaryChanged={props.onSummaryChanged}
      />
      <TariffsDesktopView {...props} />
      <TariffsMobileView {...props} />
      {props.upgradeContext || props.externalUpgradeContext ? (
        <TariffUpgradeHost {...props} />
      ) : null}
    </section>
  );
}

function TariffsDesktopView(props: TariffsViewFrameProps) {
  return (
    <div className="career-tariffs-desktop">
      <div className="career-tariffs-panel">
        <TariffsDesktopHeader onToggleCompare={props.onCompare} />
        <div className="career-tariffs-ladder">
          {TARIFF_LEVELS.map((level) => (
            <TariffCard
              key={level.id}
              level={level}
              activeTierId={props.activeTier}
              subscription={props.subscription}
              billingPanel={props.billingPanel}
              onSelectTier={props.onSelectTier}
              onRequestTier={props.onRequestTier}
            />
          ))}
        </div>
      </div>
      <TariffComparisonTable defaultOpen={props.compareOpen} />
    </div>
  );
}

function TariffsMobileView(props: TariffsViewFrameProps) {
  return (
    <div className="career-tariffs-mobile">
      <TariffMobileView
        key={props.mobileCompareRevision}
        activeTierId={props.activeTier}
        initialView={props.mobileCompareRevision > 0 ? 'cmp' : props.initialView}
        subscription={props.subscription}
        billingPanel={props.billingPanel}
        onSelectTier={props.onSelectTier}
        onRequestTier={props.onRequestTier}
      />
    </div>
  );
}

function TariffUpgradeHost(props: TariffsViewFrameProps) {
  const context = props.externalUpgradeContext ?? props.upgradeContext;
  return (
    <PaywallModal
      isOpen
      context={context!}
      summary={props.billingSummary}
      onClose={
        props.externalUpgradeContext
          ? (props.onCloseExternalUpgrade ?? props.onCloseUpgrade)
          : props.onCloseUpgrade
      }
      onNavigate={props.onNavigateToCompare}
      onSummaryChanged={props.onSummaryChanged}
    />
  );
}

function upgradeContextForTier(id: TariffTierId): TariffUpgradeContext | null {
  if (id === 'go') return { kind: 'plan', planId: 'basic' };
  if (id === 'pro' || id === 'max') return { kind: 'plan', planId: id };
  return null;
}

function tierForPlan(plan: CandidateBillingSummary['currentPlan']): TariffTierId {
  return plan === 'basic' ? 'go' : plan;
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
        Платный тариф подключается после подтверждения оплаты. Возврат на Free отключает
        автопродление; понижение между платными тарифами пока недоступно.
      </p>
    </div>
  );
}
