import { useState } from 'react';
import {
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  Clock,
  EnvelopeSimple,
  ListChecks,
  Sparkle,
  TrendUp,
} from '@phosphor-icons/react';
import {
  COMPARISON_STEPS,
  TARIFF_LEVELS,
  type TariffLevel,
  type TariffSubscriptionInfo,
  type TariffTierId,
} from './tariffsData';

interface TariffMobileViewProps {
  readonly activeTierId: TariffTierId;
  readonly initialView?: string;
  readonly subscription?: TariffSubscriptionInfo;
  readonly onSelectTier?: (id: TariffTierId) => void;
  readonly onRequestTier?: (id: TariffTierId) => void;
}

export function TariffMobileView({
  activeTierId,
  initialView = 'home',
  subscription,
  onSelectTier,
  onRequestTier,
}: TariffMobileViewProps) {
  const [currentView, setCurrentView] = useState<string>(initialView);

  if (currentView === 'cmp') {
    return <MobileComparisonView onBack={() => setCurrentView('home')} />;
  }

  if (currentView.startsWith('lvl-')) {
    const tierId = currentView.replace('lvl-', '') as TariffTierId;
    const level = TARIFF_LEVELS.find((item) => item.id === tierId) ?? TARIFF_LEVELS[0];
    return (
      <MobileLevelDetailView
        level={level}
        activeTierId={activeTierId}
        subscription={subscription}
        onBack={() => setCurrentView('home')}
        onSelectTier={onSelectTier}
        onRequestTier={onRequestTier}
      />
    );
  }

  return (
    <MobileHomeView
      activeTierId={activeTierId}
      onGoLevel={(id) => setCurrentView(`lvl-${id}`)}
      onGoCompare={() => setCurrentView('cmp')}
    />
  );
}

function MobileHomeView({
  activeTierId,
  onGoLevel,
  onGoCompare,
}: {
  readonly activeTierId: TariffTierId;
  readonly onGoLevel: (id: TariffTierId) => void;
  readonly onGoCompare: () => void;
}) {
  return (
    <div className="career-mob-view" data-mv="home">
      <div className="career-tariffs-head">
        <h2 className="career-tariffs-title">Тарифы</h2>
        <p className="career-tariffs-lead">
          Месячная подписка, автопродление, отмена в 1 клик. Перейти можно на любой тариф, а не
          только на следующий.
        </p>
      </div>

      <MobileHomeList activeTierId={activeTierId} onGoLevel={onGoLevel} />

      <button
        type="button"
        className="career-mob-link-row"
        data-go="cmp"
        onClick={onGoCompare}
      >
        <span className="career-mob-link-content">
          <ListChecks size={18} aria-hidden="true" />
          Сравнить по шагам пути
        </span>
        <CaretRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function MobileHomeList({
  activeTierId,
  onGoLevel,
}: {
  readonly activeTierId: TariffTierId;
  readonly onGoLevel: (id: TariffTierId) => void;
}) {
  return (
    <div className="career-mob-list">
      {TARIFF_LEVELS.map((level) => {
        const isActive = level.id === activeTierId;
        return (
          <button
            key={level.id}
            type="button"
            className="career-mob-row"
            data-go={`lvl-${level.id}`}
            onClick={() => onGoLevel(level.id)}
          >
            <div className="career-mob-r1">
              <span className="career-mob-name">{level.name}</span>
              <span className="career-mob-price">{level.price}</span>
            </div>
            <span className="career-mob-r2">{level.promise}</span>
            <div className="career-mob-r3">
              {isActive ? (
                <span className="career-tariff-tag">
                  <CheckCircle size={14} weight="fill" aria-hidden="true" />
                  Ваш тариф
                </span>
              ) : (
                <span className="career-tariff-sub">
                  <Clock size={14} aria-hidden="true" />
                  {level.term}
                </span>
              )}
              <CaretRight size={16} aria-hidden="true" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MobileLevelHeader({
  level,
  isActive,
  onBack,
}: {
  readonly level: TariffLevel;
  readonly isActive: boolean;
  readonly onBack: () => void;
}) {
  return (
    <>
      <div className="career-mob-header">
        <button
          type="button"
          className="career-mob-back-btn"
          onClick={onBack}
          aria-label="Назад к списку тарифов"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <div>
          <h2 className="career-tariffs-title">{level.name}</h2>
          <span className="career-tariffs-lead">
            {level.price} · {level.term}
          </span>
        </div>
      </div>

      <p className="career-tariffs-lead">{level.promise}</p>
      {isActive ? (
        <div>
          <span className="career-tariff-tag">
            <CheckCircle size={16} weight="fill" aria-hidden="true" />
            Ваш тариф
          </span>
        </div>
      ) : null}
    </>
  );
}

function MobileLevelFeatures({
  level,
  isActive,
}: {
  readonly level: TariffLevel;
  readonly isActive: boolean;
}) {
  return (
    <>
      <div className="career-mob-group">
        <h4 className="career-mob-group-title">
          {isActive ? 'Что входит' : 'Объём работы'}
        </h4>
        <ul className="career-tariff-bullet-list">
          {level.vol.map((item) => (
            <li key={item} className="career-tariff-bullet-item">
              <span className="career-tariff-bullet-icon" aria-hidden="true">
                <Check size={16} weight="bold" />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="career-mob-group">
        <h4 className="career-mob-group-title">Платформа делает сама</h4>
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
    </>
  );
}

function MobileLevelDetailView({
  level,
  activeTierId,
  subscription,
  onBack,
  onSelectTier,
  onRequestTier,
}: {
  readonly level: TariffLevel;
  readonly activeTierId: TariffTierId;
  readonly subscription?: TariffSubscriptionInfo;
  readonly onBack: () => void;
  readonly onSelectTier?: (id: TariffTierId) => void;
  readonly onRequestTier?: (id: TariffTierId) => void;
}) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const isActive = level.id === activeTierId;

  const handleAction = () => {
    if (level.id === 'exec') {
      onRequestTier?.(level.id);
      setFeedback('Заявка принята. Команда ответит в течение недели.');
    } else {
      onSelectTier?.(level.id);
      setFeedback('Оплата ещё не подключена: мы напишем, когда откроется.');
    }
  };

  return (
    <div className="career-mob-view" data-mv={`lvl-${level.id}`}>
      <MobileLevelHeader level={level} isActive={isActive} onBack={onBack} />
      <MobileLevelFeatures level={level} isActive={isActive} />
      <MobileLevelActions
        level={level}
        isActive={isActive}
        activeTierId={activeTierId}
        subscription={subscription}
        feedback={feedback}
        onAction={handleAction}
      />
    </div>
  );
}

const TIER_ORDER: readonly TariffTierId[] = ['free', 'go', 'pro', 'max', 'exec'];

function MobileActiveSubscription({
  subscription,
}: {
  readonly subscription: TariffSubscriptionInfo;
}) {
  return (
    <div className="career-mob-group">
      <h4 className="career-mob-group-title">Подписка</h4>
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
      </div>
    </div>
  );
}

function MobileUpgradeAction({
  level,
  activeTierId,
  feedback,
  onAction,
}: {
  readonly level: TariffLevel;
  readonly activeTierId: TariffTierId;
  readonly feedback: string | null;
  readonly onAction: () => void;
}) {
  const currentIdx = TIER_ORDER.indexOf(activeTierId);
  const targetIdx = TIER_ORDER.indexOf(level.id);
  const isDown = targetIdx < currentIdx;

  return (
    <div>
      {feedback ? (
        <p className="career-tariffs-lead career-mob-feedback" role="status">
          {feedback}
        </p>
      ) : null}
      <button type="button" className="career-mob-action-btn" onClick={onAction}>
        {level.request ? (
          <>
            <EnvelopeSimple size={18} aria-hidden="true" />
            Оставить заявку
          </>
        ) : level.id === 'free' ? (
          'Вернуться на Free'
        ) : (
          <>
            <TrendUp size={18} aria-hidden="true" />
            {isDown ? `Понизить до ${level.name}` : `Перейти на ${level.name}`}
          </>
        )}
      </button>
    </div>
  );
}

function MobileLevelActions({
  level,
  isActive,
  activeTierId,
  subscription,
  feedback,
  onAction,
}: {
  readonly level: TariffLevel;
  readonly isActive: boolean;
  readonly activeTierId: TariffTierId;
  readonly subscription?: TariffSubscriptionInfo;
  readonly feedback: string | null;
  readonly onAction: () => void;
}) {
  if (isActive) {
    if (level.id === 'pro' && subscription) {
      return <MobileActiveSubscription subscription={subscription} />;
    }
    return null;
  }
  return (
    <MobileUpgradeAction
      level={level}
      activeTierId={activeTierId}
      feedback={feedback}
      onAction={onAction}
    />
  );
}

function MobileComparisonGroup({
  title,
  tierIndex,
}: {
  readonly title: string;
  readonly tierIndex: number;
}) {
  const items = COMPARISON_STEPS.filter((c) => c.tierIndex === tierIndex);
  if (items.length === 0) return null;

  return (
    <div className="career-mob-group">
      <h4 className="career-mob-group-title">{title}</h4>
      <ul className="career-tariff-bullet-list">
        {items.map((item) => (
          <li key={item.title} className="career-tariff-bullet-item">
            <span className="career-tariff-bullet-icon" aria-hidden="true">
              <CheckCircle size={16} weight="fill" />
            </span>
            <span>
              {item.title}
              {item.note ? ` (${item.note})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MobileComparisonView({ onBack }: { readonly onBack: () => void }) {
  const groups = [
    { title: 'Уже на Free', tierIndex: 0 },
    { title: 'С уровня Basic', tierIndex: 1 },
    { title: 'С уровня Pro', tierIndex: 2 },
    { title: 'С уровня Max', tierIndex: 3 },
    { title: 'С уровня Executive', tierIndex: 4 },
  ];

  return (
    <div className="career-mob-view" data-mv="cmp">
      <div className="career-mob-header">
        <button
          type="button"
          className="career-mob-back-btn"
          onClick={onBack}
          aria-label="Назад к тарифам"
        >
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <div>
          <h2 className="career-tariffs-title">Сравнение</h2>
          <span className="career-tariffs-lead">по шагам пути</span>
        </div>
      </div>

      <p className="career-tariffs-lead">
        С какого уровня доступен каждый шаг. Всё, что на уровне ниже, входит и в более высокий.
      </p>

      {groups.map((group) => (
        <MobileComparisonGroup
          key={group.title}
          title={group.title}
          tierIndex={group.tierIndex}
        />
      ))}
    </div>
  );
}
