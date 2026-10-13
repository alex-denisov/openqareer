import type { ReactElement } from 'react';
import { ArrowClockwise, ChatCircleText, Clock, User, WarningCircle } from '@phosphor-icons/react';

export function CareerLoadingSkeleton(): ReactElement {
  return (
    <div className="career-screen" aria-busy="true" aria-label="Загрузка экрана карьеры">
      <div className="career-card" style={{ minHeight: '120px' }}>
        <span className="career-skeleton-line" style={{ width: '40%', height: '24px' }} />
        <span className="career-skeleton-line" style={{ width: '70%', height: '16px' }} />
      </div>
      <div className="career-card" style={{ minHeight: '280px' }}>
        <span className="career-skeleton-line" style={{ width: '50%', height: '24px' }} />
        <span className="career-skeleton-line" style={{ width: '100%', height: '60px' }} />
        <span className="career-skeleton-line" style={{ width: '100%', height: '60px' }} />
      </div>
      <p className="career-source-stamp">Позиция, гипотезы и условия грузятся независимо.</p>
    </div>
  );
}

export function CareerEmptyProfileState({
  onOpenProfile,
  onOpenExpert,
}: {
  onOpenProfile?: () => void;
  onOpenExpert?: () => void;
}): ReactElement {
  return (
    <section className="career-card" aria-label="Пустой профиль">
      <div className="career-card-head">
        <h2>Мои роли на рынке</h2>
      </div>
      <p className="career-header-lead">
        Гипотез нет: профиль пуст. Подключите источник или ответьте консультанту.
      </p>
      <div className="career-role-actions">
        <button type="button" className="career-btn career-btn-primary" onClick={onOpenProfile}>
          <User size={18} />
          Открыть профиль
        </button>
        <button type="button" className="career-btn career-btn-secondary" onClick={onOpenExpert}>
          <ChatCircleText size={18} />
          Обсудить цель
        </button>
      </div>
    </section>
  );
}

export function CareerMarketErrorState({ onRetry }: { onRetry?: () => void }): ReactElement {
  return (
    <div className="career-note career-note-error" role="alert">
      <WarningCircle size={20} />
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0 }}>
          Позиция на рынке не загрузилась: каталог не ответил. Гипотезы и условия доступны.
        </p>
      </div>
      <button
        type="button"
        className="career-btn career-btn-secondary"
        style={{ minHeight: '36px', padding: '4px 12px' }}
        onClick={onRetry}
      >
        <ArrowClockwise size={16} />
        Повторить
      </button>
    </div>
  );
}

export function CareerStaleMarketNote({ dateText }: { dateText: string }): ReactElement {
  return (
    <div className="career-note" role="status">
      <Clock size={18} />
      <span>Выборка устарела: рынок обновлён {dateText}, прошло больше 14 дней. Цифры показаны с датой.</span>
    </div>
  );
}
