import { ArrowRight, ClockCountdown, Sparkle } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { TodayQueueItem, TodaySnapshot } from './todayApi';

/**
 * «Сегодня» (B251 S5): дайджест дня и очередь решений. Первая строка очереди
 * несёт то же обещание, что и заголовок дизайна — «одно следующее
 * действие» — и выделена, а не перечислена наравне с остальными (макет
 * B248/today.html).
 *
 * «С прошлого визита» и follow-up по срокам сюда не входят — отдельный срез.
 */
export interface TodayScreenProps {
  readonly snapshot: TodaySnapshot | null;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

export function TodayScreen({ snapshot, loading, failed, onRetry }: TodayScreenProps) {
  if (failed) return <TodayError onRetry={onRetry} />;
  if (loading && !snapshot) return <TodaySkeleton />;
  if (!snapshot) return null;

  const { digest, queue, vacanciesPending } = snapshot;

  return (
    <div className="career-today">
      <TodayDigest digest={digest} />
      {vacanciesPending ? <TodayPendingNotice /> : null}
      <TodayQueue queue={queue} />
    </div>
  );
}

function TodayDigest({ digest }: { digest: TodaySnapshot['digest'] }) {
  return (
    <div className="career-today-digest">
      <DigestCard
        value={digest.newVacancies}
        label={pluralRu(digest.newVacancies, ['новая вакансия', 'новые вакансии', 'новых вакансий'])}
      />
      <DigestCard
        value={digest.waitingForYou}
        label="ждут вашего ответа"
        attention={digest.waitingForYou > 0}
      />
      <DigestCard
        value={digest.closedVacancies}
        label={pluralRu(digest.closedVacancies, [
          'вакансия закрылась',
          'вакансии закрылись',
          'вакансий закрылись',
        ])}
      />
    </div>
  );
}

function TodayPendingNotice() {
  return (
    <p className="career-today-pending">
      <Sparkle size={16} aria-hidden="true" />
      Подбор обновляется — новые вакансии появятся здесь без перезагрузки.
    </p>
  );
}

function TodayQueue({ queue }: { queue: readonly TodayQueueItem[] }) {
  const [nextAction, ...rest] = queue;
  return (
    <section className="career-today-queue" aria-label="Очередь дня">
      <header className="career-today-queue-head">
        <h2>Очередь дня</h2>
        <span className="career-today-hint">
          {pluralRu(queue.length, ['карточка', 'карточки', 'карточек'])} · решение нужно по
          каждой
        </span>
      </header>
      {queue.length === 0 ? (
        <p className="career-today-empty">Очередь пуста — новых решений на сегодня нет.</p>
      ) : (
        <ul className="career-today-list">
          <QueueRow item={nextAction} isNextAction />
          {rest.map((item) => (
            <QueueRow key={queueKey(item)} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DigestCard({
  value,
  label,
  attention = false,
}: {
  value: number;
  label: string;
  attention?: boolean;
}) {
  return (
    <div className={`career-today-digest-card${attention ? ' is-attention' : ''}`}>
      <span className="career-today-digest-number">{value}</span>
      <span className="career-today-digest-label">{label}</span>
    </div>
  );
}

function QueueRow({ item, isNextAction = false }: { item: TodayQueueItem; isNextAction?: boolean }) {
  return (
    <li className={`career-today-item${isNextAction ? ' is-next-action' : ''}`}>
      <div className="career-today-item-body">
        {isNextAction ? (
          <span className="career-today-item-flag">
            <ArrowRight size={14} aria-hidden="true" />
            Следующее действие
          </span>
        ) : null}
        <span className="career-today-item-kind">{queueKindLabel(item)}</span>
        <span className="career-today-item-title">{item.title}</span>
      </div>
    </li>
  );
}

function queueKindLabel(item: TodayQueueItem): string {
  if (item.kind === 'new_vacancy') return 'Новая вакансия';
  return 'Ваш ход';
}

function queueKey(item: TodayQueueItem): string {
  return item.applicationId ?? item.clusterId ?? item.title;
}

function TodaySkeleton() {
  return (
    <div className="career-today" aria-busy="true" aria-label="Читаем очередь дня">
      <div className="career-today-digest">
        <div className="career-skeleton-line is-wide career-today-digest-card" />
        <div className="career-skeleton-line is-wide career-today-digest-card" />
        <div className="career-skeleton-line is-wide career-today-digest-card" />
      </div>
      <div className="career-skeleton-line is-wide" />
      <div className="career-skeleton-line is-wide" />
      <div className="career-skeleton-line is-short" />
    </div>
  );
}

function TodayError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="career-today-state career-today-state-error">
      <ClockCountdown size={28} aria-hidden="true" />
      <h3>Не удалось обновить очередь дня</h3>
      <p>Часть данных ещё обновляется. Повторите запрос.</p>
      <button type="button" className="career-btn career-btn-primary" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}
