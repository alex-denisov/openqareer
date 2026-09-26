import { ClockCountdown, DotsThreeVertical, Sparkle } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { TodayDigest, TodayFollowUp, TodayQueueItem, TodaySnapshot } from './todayApi';
import { formatTodaySalary } from './todayCompensation';
import { companyInitials, digestBasis, followUpStatusLabel } from './todayFormat';

/**
 * «Сегодня» (B251 S5): дайджест дня, очередь решений, follow-up по срокам и
 * дайджест «с прошлого визита» — по макету `B248/today.html`. Первая строка
 * очереди несёт то же обещание, что и заголовок дизайна — «одно следующее
 * действие» — и выделена акцентной рамкой, а не отдельным текстовым флагом:
 * флаг «Следующее действие» налезал на подпись причины (owner review
 * 2026-09-24).
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

  const { digest, queue, followUps, sinceLastVisit, vacanciesPending } = snapshot;
  // The digest and the queue always show (B266): an empty queue is a
  // statement about today, not a reason to hide the counts behind one card.
  return (
    <div className="career-today">
      <p className="career-today-subtitle">
        Что изменилось с прошлого визита и что решить сегодня.
      </p>
      {vacanciesPending ? <TodayPendingNotice /> : null}
      <TodayDigestRow digest={digest} />
      <div className="career-today-panels">
        <TodayQueue queue={queue} />
        <div className="career-today-side">
          <TodayFollowUps followUps={followUps} />
          <TodaySinceLastVisit items={sinceLastVisit.items} />
        </div>
      </div>
    </div>
  );
}

function TodayDigestRow({ digest }: { digest: TodayDigest }) {
  return (
    <div className="career-today-digest">
      <DigestCard
        value={digest.newVacancies}
        label={pluralRu(digest.newVacancies, [
          'новая релевантная вакансия с прошлого визита',
          'новые релевантные вакансии с прошлого визита',
          'новых релевантных вакансий с прошлого визита',
        ])}
        basis={digestBasis('new', digest)}
      />
      <DigestCard
        value={digest.followUpsDueToday}
        label="follow-up назначено на сегодня"
        basis={digestBasis('followUp', digest)}
        attention={digest.followUpsDueToday > 0}
      />
      <DigestCard
        value={digest.interviewsAhead}
        label={pluralRu(digest.interviewsAhead, [
          'интервью впереди, нужна подготовка',
          'интервью впереди, нужна подготовка',
          'интервью впереди, нужна подготовка',
        ])}
        basis={digestBasis('interview', digest)}
      />
    </div>
  );
}

function DigestCard({
  value,
  label,
  basis,
  attention = false,
}: {
  value: number;
  label: string;
  basis: string | null;
  attention?: boolean;
}) {
  return (
    <div className={`career-today-digest-card${attention ? ' is-attention' : ''}`}>
      <span className="career-today-digest-number">{value}</span>
      <span className="career-today-digest-label">{label}</span>
      {basis ? <span className="career-today-digest-basis">{basis}</span> : null}
    </div>
  );
}

function TodayQueue({ queue }: { queue: readonly TodayQueueItem[] }) {
  return (
    <section className="career-today-queue" aria-label="Очередь дня">
      <header className="career-today-queue-head">
        <h2>Очередь дня</h2>
        <span className="career-today-hint">
          {pluralRu(queue.length, ['карточка', 'карточки', 'карточек'])} · решение нужно по каждой
        </span>
      </header>
      {queue.length === 0 ? (
        <p className="career-today-empty">
          Решений на сегодня нет: подборка разобрана. Добавьте роль или регион в «Вакансиях» —
          подборка пополнится.
        </p>
      ) : (
        <ul className="career-today-list">
          {queue.map((item, index) => (
            <QueueRow key={queueKey(item)} item={item} isFirst={index === 0} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueRow({ item, isFirst }: { item: TodayQueueItem; isFirst: boolean }) {
  const salary = formatTodaySalary(item.salary);
  const isVacancy = item.kind === 'new_vacancy' || item.kind === 'shortlist';
  const secondLine = isVacancy ? (salary ?? 'вилка не указана') : (salary ?? 'Ждём вас');
  const isAccentKind = item.kind === 'follow_up' || item.kind === 'interview';

  return (
    <li className={`career-today-item${isFirst ? ' is-first' : ''}`}>
      <span className="career-today-item-logo">{companyInitials(item.company)}</span>
      <div className="career-today-item-body">
        <span className={`career-today-item-kind${isAccentKind ? ' is-accent' : ''}`}>
          {item.eyebrow ?? queueKindLabel(item)}
        </span>
        <div className="career-today-item-title">
          {item.company ? `${item.company} — ${item.title}` : item.title}
        </div>
        <div className="career-today-item-meta">
          <span className="metric">{secondLine}</span>
          {item.location ? <span>{item.location}</span> : null}
        </div>
      </div>
      {item.fit ? <QueueFit fit={item.fit} /> : <span className="career-today-item-fit" />}
      <div className="career-today-item-actions">
        <QueueAction item={item} />
        <button
          type="button"
          className="career-btn-icon"
          aria-haspopup="menu"
          aria-label="Ещё действия"
        >
          <DotsThreeVertical size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function QueueFit({ fit }: { fit: NonNullable<TodayQueueItem['fit']> }) {
  return (
    <div className="career-today-item-fit">
      <FitDot ok={fit.role !== 'none'} label="роль" />
      <FitDot ok={fit.level === null ? null : fit.level !== 'none'} label="уровень" />
      <FitDot ok={fit.geo} label="гео" />
    </div>
  );
}

function FitDot({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="career-today-fit-dot is-unknown">{label} —</span>;
  return (
    <span className={`career-today-fit-dot${ok ? ' is-yes' : ' is-no'}`}>
      {ok ? label : `${label} —`}
    </span>
  );
}

function QueueAction({ item }: { item: TodayQueueItem }) {
  if (item.kind === 'follow_up') {
    return (
      <button type="button" className="career-btn career-btn-primary career-btn-sm">
        Написать сейчас
      </button>
    );
  }
  if (item.kind === 'interview') {
    return (
      <button type="button" className="career-btn career-btn-primary career-btn-sm">
        Подготовиться
      </button>
    );
  }
  return (
    <button type="button" className="career-btn career-btn-secondary career-btn-sm">
      Открыть
    </button>
  );
}

function TodayFollowUps({ followUps }: { followUps: readonly TodayFollowUp[] }) {
  if (followUps.length === 0) return null;
  return (
    <section className="career-today-followups" aria-label="Follow-up по срокам">
      <h2>Follow-up по срокам</h2>
      <ul>
        {followUps.map((item) => (
          <li key={item.applicationId} className="career-today-followup-item">
            <span className="career-today-followup-who">
              {item.company ? `${item.company} — ${item.title}` : item.title}
            </span>
            <span className={`career-today-followup-when metric is-${item.status}`}>
              {followUpStatusLabel(item.status)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TodaySinceLastVisit({ items }: { items: readonly string[] }) {
  return (
    <section className="career-today-since" aria-label="С прошлого визита">
      <h2>С прошлого визита</h2>
      {items.length > 0 ? (
        <ul>
          {items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="career-today-since-empty">Новых вакансий и событий нет.</p>
      )}
    </section>
  );
}

function queueKindLabel(item: TodayQueueItem): string {
  if (item.kind === 'new_vacancy') return 'Новая вакансия';
  if (item.kind === 'shortlist') return 'Из подборки';
  if (item.kind === 'follow_up') return 'Follow-up';
  if (item.kind === 'interview') return 'Интервью';
  return 'Ваш ход';
}

function queueKey(item: TodayQueueItem): string {
  return item.applicationId ?? item.clusterId ?? item.title;
}

function TodayPendingNotice() {
  return (
    <p className="career-today-pending">
      <Sparkle size={16} aria-hidden="true" />
      Подбор обновляется — новые вакансии появятся здесь без перезагрузки.
    </p>
  );
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
