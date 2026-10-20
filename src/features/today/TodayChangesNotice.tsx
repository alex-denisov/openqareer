import { useState } from 'react';
import { BellSimple, X } from '@phosphor-icons/react';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { NavigationOptions } from '../shell/pathIndicator';
import type { TodaySinceLastVisit } from './todayApi';
import { todayChangeTarget, todayChangesSentence } from './todayFormat';

interface TodayChangesNoticeProps {
  readonly sinceLastVisit: TodaySinceLastVisit;
  readonly onNavigate?: (view: CareerCabinetView, options?: NavigationOptions) => void;
  /** Отметка «скрыто» на сервере; при ошибке полоса возвращается. */
  readonly onDismiss: () => Promise<void>;
}

function shortDateTime(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Полоса «С 05.10, 18:40: … Смотреть ×» (макет 1): только события с прошлого визита. */
export function TodayChangesNotice({
  sinceLastVisit,
  onNavigate,
  onDismiss,
}: TodayChangesNoticeProps) {
  const [hidden, setHidden] = useState(false);
  const changes = sinceLastVisit.changes ?? [];
  const since = shortDateTime(sinceLastVisit.since);
  const first = changes[0];
  if (hidden || !first || !since) return null;
  const dismiss = async () => {
    setHidden(true);
    try {
      await onDismiss();
    } catch {
      setHidden(false);
    }
  };
  return (
    <section className="career-today-changes" aria-label="Изменения с прошлого визита">
      <BellSimple size="1em" aria-hidden="true" />
      <p>
        <span className="career-today-changes-since">С {since}:</span>{' '}
        <span className="career-today-changes-summary">{todayChangesSentence(changes)}</span>{' '}
        {onNavigate ? (
          <button
            className="career-today-changes-link"
            type="button"
            onClick={() => {
              const target = todayChangeTarget(first);
              onNavigate(target.view, target.options);
            }}
          >
            Смотреть
          </button>
        ) : null}
      </p>
      <button
        className="career-today-changes-close"
        type="button"
        aria-label="Скрыть уведомление"
        onClick={() => void dismiss()}
      >
        <X size="1em" aria-hidden="true" />
      </button>
    </section>
  );
}
