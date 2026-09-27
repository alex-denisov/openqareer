import { useState } from 'react';
import { ClockCountdown, DotsThreeVertical, Sparkle } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { TodayDigest, TodayFollowUp, TodayQueueItem, TodaySnapshot } from './todayApi';
import { formatTodaySalary } from './todayCompensation';
import { companyInitials, digestBasis, followUpStatusLabel } from './todayFormat';
import { vacancyLevelMatchLabel } from '../vacancies/vacancyLevelMatch';

const NO_PENDING_FOLLOW_UPS: ReadonlySet<string> = new Set();

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
  readonly onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  readonly markingFollowUpIds?: ReadonlySet<string>;
}

export function TodayScreen({
  snapshot,
  loading,
  failed,
  onRetry,
  onMarkFollowUpSent,
  markingFollowUpIds = NO_PENDING_FOLLOW_UPS,
}: TodayScreenProps) {
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
        <TodayQueue
          queue={queue}
          sinceLastVisitItems={sinceLastVisit.items}
          onMarkFollowUpSent={onMarkFollowUpSent}
          markingFollowUpIds={markingFollowUpIds}
        />
        <div className="career-today-side">
          <TodayFollowUps
            followUps={followUps}
            onMarkFollowUpSent={onMarkFollowUpSent}
            markingFollowUpIds={markingFollowUpIds}
          />
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
        value={digest.followUpsOverdue}
        label="follow-up просрочено"
        basis={null}
        attention={digest.followUpsOverdue > 0}
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

/**
 * Только факты, которых ещё нет цифрой в KPI-плитках выше (B248/design п.5,
 * C55): счётчик новых вакансий уже показан плиткой «новая релевантная
 * вакансия…», второй раз тем же числом — не строка-подсказка, а шум.
 */
function sinceHintOf(items: readonly string[]) {
  const extra = items.filter((item) => !/вакан/u.test(item));
  if (extra.length === 0) return null;
  return <p className="career-today-since-hint">{extra.join(' · ')}</p>;
}

function TodayQueue({
  queue,
  sinceLastVisitItems,
  onMarkFollowUpSent,
  markingFollowUpIds,
}: {
  queue: readonly TodayQueueItem[];
  sinceLastVisitItems: readonly string[];
  onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  markingFollowUpIds: ReadonlySet<string>;
}) {
  return (
    <section className="career-today-queue" aria-label="Очередь дня">
      <header className="career-today-queue-head">
        <h2>Очередь дня</h2>
        <span className="career-today-hint">
          {pluralRu(queue.length, ['карточка', 'карточки', 'карточек'])} · решение нужно по каждой
        </span>
      </header>
      {sinceHintOf(sinceLastVisitItems)}
      {queue.length === 0 ? (
        <p className="career-today-empty">
          Решений на сегодня нет: подборка разобрана. Новые вакансии появятся здесь сами.
        </p>
      ) : (
        <ul className="career-today-list">
          {queue.map((item, index) => (
            <QueueRow
              key={queueKey(item)}
              item={item}
              isFirst={index === 0}
              onMarkFollowUpSent={onMarkFollowUpSent}
              markingFollowUpIds={markingFollowUpIds}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueRow({
  item,
  isFirst,
  onMarkFollowUpSent,
  markingFollowUpIds,
}: {
  item: TodayQueueItem;
  isFirst: boolean;
  onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  markingFollowUpIds: ReadonlySet<string>;
}) {
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
        <QueueAction
          item={item}
          onMarkFollowUpSent={onMarkFollowUpSent}
          markingFollowUpIds={markingFollowUpIds}
        />
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
      <FitDot
        ok={fit.level === 'match' ? true : fit.level === 'unknown' ? null : false}
        label="уровень"
        title={vacancyLevelMatchLabel(fit.level)}
      />
      <FitDot ok={fit.geo} label="гео" />
    </div>
  );
}

function FitDot({ ok, label, title }: { ok: boolean | null; label: string; title?: string }) {
  if (ok === null) {
    return (
      <span className="career-today-fit-dot is-unknown" title={title} aria-label={title}>
        {label} —
      </span>
    );
  }
  return (
    <span className={`career-today-fit-dot${ok ? ' is-yes' : ' is-no'}`} title={title}>
      {ok ? label : `${label} —`}
    </span>
  );
}

function QueueAction({
  item,
  onMarkFollowUpSent,
  markingFollowUpIds,
}: {
  item: TodayQueueItem;
  onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  markingFollowUpIds: ReadonlySet<string>;
}) {
  if (item.kind === 'follow_up') {
    return item.applicationId ? (
      <MarkFollowUpButton
        applicationId={item.applicationId}
        isSaving={markingFollowUpIds.has(item.applicationId)}
        onMark={onMarkFollowUpSent}
      />
    ) : null;
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

function TodayFollowUps({
  followUps,
  onMarkFollowUpSent,
  markingFollowUpIds,
}: {
  followUps: readonly TodayFollowUp[];
  onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  markingFollowUpIds: ReadonlySet<string>;
}) {
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
            {item.status === 'sent' ? null : (
              <MarkFollowUpButton
                applicationId={item.applicationId}
                isSaving={markingFollowUpIds.has(item.applicationId)}
                onMark={onMarkFollowUpSent}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MarkFollowUpButton({
  applicationId,
  isSaving,
  onMark,
}: {
  applicationId: string;
  isSaving: boolean;
  onMark: (applicationId: string) => Promise<void>;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="career-today-followup-action">
      {failed ? <span role="alert">Не удалось сохранить отметку.</span> : null}
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        disabled={isSaving}
        aria-busy={isSaving}
        onClick={() => {
          setFailed(false);
          void onMark(applicationId).catch(() => setFailed(true));
        }}
      >
        {isSaving ? 'Сохраняем…' : 'Отметить отправленным'}
      </button>
    </span>
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
      Считаем вашу подборку — секунду. Если очередь пуста дольше минуты, откройте «Вакансии».
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
