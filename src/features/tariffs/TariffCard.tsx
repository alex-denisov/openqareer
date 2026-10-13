import type { ReactNode } from 'react';
import {
  CaretDown,
  Check,
  CheckCircle,
  EnvelopeSimple,
  Minus,
  Sparkle,
  TrendUp,
} from '@phosphor-icons/react';
import {
  COMPARISON_STEPS,
  type TariffLevel,
  type TariffSubscriptionInfo,
  type TariffTierId,
} from './tariffsData';

interface TariffCardProps {
  readonly level: TariffLevel;
  readonly activeTierId: TariffTierId;
  readonly defaultOpen?: boolean;
  readonly subscription?: TariffSubscriptionInfo;
  readonly billingPanel?: ReactNode;
  readonly onSelectTier?: (id: TariffTierId) => void;
  readonly onRequestTier?: (id: TariffTierId) => void;
}

export function TariffCard({
  level,
  activeTierId,
  defaultOpen,
  subscription,
  billingPanel,
  onSelectTier,
  onRequestTier,
}: TariffCardProps) {
  const isActive = level.id === activeTierId;
  const isExec = level.id === 'exec';

  const handleAction = () => {
    if (isExec) onRequestTier?.(level.id);
    else onSelectTier?.(level.id);
  };

  return (
    <details
      className={`career-tariff-card ${isActive ? 'is-active' : ''}`}
      id={`lvl-${level.id}`}
      open={defaultOpen ?? isActive}
    >
      <TariffCardSummary
        level={level}
        isActive={isActive}
        activeTierId={activeTierId}
        onAction={handleAction}
      />
      <TariffCardBody
        level={level}
        isActive={isActive}
        subscription={subscription}
        billingPanel={billingPanel}
      />
    </details>
  );
}

function TariffCardSummary({
  level,
  isActive,
  activeTierId,
  onAction,
}: {
  readonly level: TariffLevel;
  readonly isActive: boolean;
  readonly activeTierId: TariffTierId;
  readonly onAction: () => void;
}) {
  return (
    <summary className="career-tariff-summary">
      <div className="career-tariff-meta">
        <span className="career-tariff-name">{level.name}</span>
        <span className="career-tariff-sub">{level.sub}</span>
      </div>
      <div className="career-tariff-pricing">
        <span className="career-tariff-price">{level.price}</span>
        <span className="career-tariff-term">{level.term}</span>
      </div>
      <span className="career-tariff-promise">{level.promise}</span>
      <div className="career-tariff-actions">
        {isActive ? (
          <span className="career-tariff-tag">
            <CheckCircle size={16} weight="fill" aria-hidden="true" />
            Ваш тариф
          </span>
        ) : (
          <TariffActionButton level={level} activeTierId={activeTierId} onAction={onAction} />
        )}
        <span className="career-tariff-expand">
          <span className="career-tariff-expand-label">Что входит</span>
          <span className="career-tariff-chevron" aria-hidden="true">
            <CaretDown size={18} />
          </span>
        </span>
      </div>
    </summary>
  );
}

const TIER_ORDER: readonly TariffTierId[] = ['free', 'go', 'pro', 'max', 'exec'];

function TariffActionButton({
  level,
  activeTierId,
  onAction,
}: {
  readonly level: TariffLevel;
  readonly activeTierId: TariffTierId;
  readonly onAction: () => void;
}) {
  const currentIdx = TIER_ORDER.indexOf(activeTierId);
  const targetIdx = TIER_ORDER.indexOf(level.id);
  const isDown = targetIdx < currentIdx;

  if (level.request) {
    return (
      <button className="career-btn is-sm" type="button" onClick={onAction}>
        <EnvelopeSimple size={16} aria-hidden="true" />
        Оставить заявку
      </button>
    );
  }
  if (level.id === 'free') {
    return (
      <button className="career-btn is-sm" type="button" onClick={onAction}>
        <CaretDown size={16} aria-hidden="true" />
        Вернуться на Free
      </button>
    );
  }
  return (
    <button className="career-btn is-sm" type="button" onClick={onAction}>
      {isDown ? (
        <CaretDown size={16} aria-hidden="true" />
      ) : (
        <TrendUp size={16} aria-hidden="true" />
      )}
      {isDown ? `Понизить до ${level.name}` : `Перейти на ${level.name}`}
    </button>
  );
}

function TariffCardBody({
  level,
  isActive,
  subscription,
  billingPanel,
}: {
  readonly level: TariffLevel;
  readonly isActive: boolean;
  readonly subscription?: TariffSubscriptionInfo;
  readonly billingPanel?: ReactNode;
}) {
  return (
    <div className="career-tariff-body">
      {isActive ? (
        <TariffCardCurrentIncluded level={level} subscription={subscription} />
      ) : (
        <TariffCardVolumeSection level={level} isActive={false} />
      )}
      {isActive ? (
        <TariffCardCurrentDetails level={level} billingPanel={billingPanel} />
      ) : (
        <TariffCardAutomationSection level={level} />
      )}
    </div>
  );
}

function TariffCardVolumeSection({
  level,
  isActive,
  includeAutomation = false,
}: {
  readonly level: TariffLevel;
  readonly isActive: boolean;
  readonly includeAutomation?: boolean;
}) {
  const items = [
    ...level.vol.map((text) => ({ text, automation: false })),
    ...(includeAutomation ? level.auto.map((text) => ({ text, automation: true })) : []),
  ];
  return (
    <div className="career-tariff-section">
      <h4 className="career-tariff-section-title">{isActive ? 'Что входит' : 'Объём работы'}</h4>
      <ul className="career-tariff-bullet-list">
        {items.map(({ text, automation }) => (
          <li key={text} className="career-tariff-bullet-item">
            <span
              className={`career-tariff-bullet-icon${automation ? ' is-sparkle' : ''}`}
              aria-hidden="true"
            >
              {automation ? <Sparkle size={16} weight="fill" /> : <Check size={16} weight="bold" />}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TariffCardBillingSection({ billingPanel }: { readonly billingPanel: ReactNode }) {
  return (
    <div className="career-tariff-section career-tariff-billing-section">
      <h4 className="career-tariff-section-title">Подписка</h4>
      {billingPanel}
    </div>
  );
}

function TariffCardCurrentIncluded({
  level,
  subscription,
}: {
  readonly level: TariffLevel;
  readonly subscription?: TariffSubscriptionInfo;
}) {
  return (
    <div className="career-tariff-current-included">
      <TariffCardVolumeSection level={level} isActive includeAutomation={level.id !== 'free'} />
      {level.id === 'pro' && subscription ? (
        <ProSubscriptionBlock subscription={subscription} />
      ) : null}
    </div>
  );
}

function TariffCardAutomationSection({ level }: { readonly level: TariffLevel }) {
  return (
    <div className="career-tariff-section">
      <h4 className="career-tariff-section-title">Платформа делает сама</h4>
      <ul className="career-tariff-bullet-list">
        {level.auto.map((item) => (
          <li key={item} className="career-tariff-bullet-item">
            <span className="career-tariff-bullet-icon is-sparkle" aria-hidden="true">
              <Sparkle size={16} weight="fill" />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MISSING_ON_FREE = [
  'Материалы под вакансию и тренировки интервью: с Basic',
  'Отправка откликов платформой: с Pro',
  'Эксперт на резюме, интервью и оффер: с Max',
] as const;

const TIER_RANK: Record<TariffTierId, number> = {
  free: 0,
  go: 1,
  pro: 2,
  max: 3,
  exec: 4,
};

function TariffCardMissingSection({ level }: { readonly level: TariffLevel }) {
  const missing =
    level.id === 'free'
      ? MISSING_ON_FREE
      : COMPARISON_STEPS.filter((step) => step.tierIndex > TIER_RANK[level.id]).map(
          (step) => step.title,
        );
  return (
    <div className="career-tariff-section">
      <h4 className="career-tariff-section-title">Чего нет на этом тарифе</h4>
      <ul className="career-tariff-bullet-list">
        {missing.map((item) => (
          <li key={item} className="career-tariff-bullet-item">
            <span className="career-tariff-bullet-icon is-off" aria-hidden="true">
              <Minus size={16} />
            </span>
            <span>{item}</span>
          </li>
        ))}
        {missing.length === 0 ? (
          <li className="career-tariff-bullet-item">
            <span>Более высокого уровня в линейке нет.</span>
          </li>
        ) : null}
      </ul>
      {level.id === 'free' ? (
        <p className="career-tariffs-lead career-tariffs-note">
          Бесплатно без срока, карта не нужна. Перейти на любой тариф можно в любой момент.
        </p>
      ) : null}
    </div>
  );
}

function TariffCardCurrentDetails({
  level,
  billingPanel,
}: {
  readonly level: TariffLevel;
  readonly billingPanel?: ReactNode;
}) {
  return (
    <div className="career-tariff-current-details">
      <TariffCardMissingSection level={level} />
      {level.id !== 'free' && billingPanel ? (
        <TariffCardBillingSection billingPanel={billingPanel} />
      ) : null}
    </div>
  );
}

function ProSubscriptionBlock({ subscription }: { readonly subscription: TariffSubscriptionInfo }) {
  return (
    <div className="career-tariff-sub-section">
      <h4 className="career-tariff-section-title">Подписка</h4>
      <div className="career-tariff-sub-block">
        <div className="career-tariff-sub-row">
          <span className="career-tariff-sub-label">Действует до</span>
          <span className="career-tariff-sub-value">{subscription.activeUntil}</span>
        </div>
        <div className="career-tariff-sub-row">
          <span className="career-tariff-sub-label">Автопродление</span>
          <span className="career-tariff-sub-value">
            {subscription.autoRenew ? 'Включено' : 'Выключено'}
          </span>
        </div>
        <div className="career-tariff-sub-row">
          <span className="career-tariff-sub-label">Оплата</span>
          <span className="career-tariff-sub-value">{subscription.paymentMethod}</span>
        </div>
        <div className="career-tariff-sub-row">
          <span className="career-tariff-sub-label">Расход сегодня</span>
          <span className="career-tariff-sub-value">
            Отправок {subscription.todayUsage.used} из {subscription.todayUsage.total}
          </span>
        </div>
      </div>
    </div>
  );
}
