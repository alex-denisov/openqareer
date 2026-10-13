import { useState } from 'react';
import { LinkedinDraftCard } from './LinkedinDraftCard';
import { SearchMomentum } from './SearchMomentum';
import { ExecutiveOnboardingCard } from '../onboarding/ExecutiveOnboardingCard';
import { ClockCountdown, Sparkle, X } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { CompanyReminderModal } from './CompanyReminderModal';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import {
  deferConsultantActionUntilTomorrow,
  isConsultantActionResolved,
  resolveConsultantAction,
} from './consultantActionStorage';
import type { TodayFollowUp, TodayQueueItem, TodaySnapshot } from './todayApi';
import { formatTodaySalary } from './todayCompensation';
import { TodayDesktopContent, type TodayFunnelContext } from './TodayDesktop';
import { TodayDigestRow, TodayReturnBanner } from './TodayMobileHeader';
export type { TodayFunnelContext } from './TodayDesktop';
import {
  companyInitials,
  consultantTargetView,
  followUpStatusLabel,
  formatQueueTitle,
  queueItemTarget,
  queueKey,
} from './todayFormat';
export { consultantTargetView, queueItemTarget } from './todayFormat';
import { vacancyLevelMatchLabel } from '../vacancies/vacancyLevelMatch';
import { CareerTooltip } from '../shell/CareerTooltip';
import { useCareerDiaryAccess } from '../shell/careerDiaryAccess';
import type { ResumeDraft } from '../resume/resumeTypes';

const NO_PENDING_FOLLOW_UPS: ReadonlySet<string> = new Set();

/**
 * Маршрутизация действия консультанта в разделы кабинета.
 * Read-only действия открывают соответствующий раздел без создания фоновых команд.
 */
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
  readonly candidateId?: string;
  readonly consultantAction?: ReasonedCareerAction;
  readonly profileDraft?: ResumeDraft;
  readonly funnelContext?: TodayFunnelContext;
  readonly onOpenTariffs?: () => void;
  readonly onOpenExpert?: () => void;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}

function useTodayConsultantAction({
  candidateId,
  consultantAction,
  onNavigate,
  onOpenExpert,
}: {
  candidateId?: string;
  consultantAction?: ReasonedCareerAction;
  onNavigate?: (view: CareerCabinetView) => void;
  onOpenExpert?: () => void;
}) {
  const [resolvedActionKey, setResolvedActionKey] = useState<string | null>(null);
  const currentActionKey = consultantAction?.headline ?? null;
  const isResolved =
    !consultantAction ||
    resolvedActionKey === currentActionKey ||
    isConsultantActionResolved(candidateId, consultantAction);
  const activeAction = isResolved ? undefined : consultantAction;

  const onAccept = () => {
    if (!consultantAction) return;
    if (consultantAction.destination === 'coach') {
      onOpenExpert?.();
      return;
    }
    resolveConsultantAction(candidateId, consultantAction, 'accepted');
    setResolvedActionKey(consultantAction.headline);
    onNavigate?.(consultantTargetView(consultantAction.destination));
  };

  const onDismiss = () => {
    if (!consultantAction) return;
    resolveConsultantAction(candidateId, consultantAction, 'dismissed');
    setResolvedActionKey(consultantAction.headline);
  };

  const onPostpone = () => {
    if (!consultantAction) return;
    deferConsultantActionUntilTomorrow(candidateId, consultantAction);
    setResolvedActionKey(consultantAction.headline);
  };

  return { activeAction, onAccept, onDismiss, onPostpone };
}

export function TodayScreen({
  snapshot,
  loading,
  failed,
  onRetry,
  onMarkFollowUpSent,
  markingFollowUpIds = NO_PENDING_FOLLOW_UPS,
  candidateId,
  consultantAction,
  profileDraft,
  funnelContext,
  onNavigate,
  onOpenTariffs,
  onOpenExpert,
}: TodayScreenProps) {
  const { activeAction, onAccept, onDismiss, onPostpone } = useTodayConsultantAction({
    candidateId,
    consultantAction,
    onNavigate,
    onOpenExpert,
  });

  if (failed) return <TodayError onRetry={onRetry} />;
  if (loading && !snapshot) return <TodaySkeleton />;
  if (!snapshot) return null;

  return (
    <TodayContent
      snapshot={snapshot}
      onOpenTariffs={onOpenTariffs}
      activeAction={activeAction}
      onAccept={onAccept}
      onDismiss={onDismiss}
      onPostpone={onPostpone}
      onMarkFollowUpSent={onMarkFollowUpSent}
      markingFollowUpIds={markingFollowUpIds}
      onNavigate={onNavigate}
      onOpenExpert={onOpenExpert}
      profileDraft={profileDraft}
      funnelContext={funnelContext}
    />
  );
}

interface TodayContentProps {
  readonly snapshot: TodaySnapshot;
  readonly profileDraft?: ResumeDraft;
  readonly funnelContext?: TodayFunnelContext;
  readonly onOpenExpert?: () => void;
  readonly activeAction?: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
  readonly onPostpone: () => void;
  readonly onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  readonly markingFollowUpIds: ReadonlySet<string>;
  readonly onOpenTariffs?: () => void;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}

function TodayContent(props: TodayContentProps) {
  return (
    <div className="career-today">
      <TodayMobileContent {...props} />
      <TodayDesktopContent
        snapshot={props.snapshot}
        profileDraft={props.profileDraft}
        funnelContext={props.funnelContext}
        activeAction={props.activeAction}
        onAccept={props.onAccept}
        onDiscuss={props.onOpenExpert}
        onPostpone={props.onPostpone}
        onNavigate={props.onNavigate}
      />
    </div>
  );
}

function TodayMobileContent({
  snapshot,
  activeAction,
  onAccept,
  onDismiss,
  onMarkFollowUpSent,
  markingFollowUpIds,
  onNavigate,
  onOpenTariffs,
}: Pick<
  TodayContentProps,
  | 'snapshot'
  | 'activeAction'
  | 'onAccept'
  | 'onDismiss'
  | 'onMarkFollowUpSent'
  | 'markingFollowUpIds'
  | 'onNavigate'
  | 'onOpenTariffs'
>) {
  const { queue, followUps, sinceLastVisit } = snapshot;
  return (
    <div className="career-today-mobile">
      <TodayMobileIntro snapshot={snapshot} onNavigate={onNavigate} />
      <TodayDigestRow digest={snapshot.digest} />
      <SearchMomentum momentum={snapshot.momentum} onNavigate={onNavigate} />
      <div className="career-today-panels">
        <TodayQueue
          queue={queue}
          sinceLastVisitItems={sinceLastVisit.items}
          onMarkFollowUpSent={onMarkFollowUpSent}
          markingFollowUpIds={markingFollowUpIds}
          consultantAction={activeAction}
          onAcceptConsultant={onAccept}
          onDismissConsultant={onDismiss}
          onNavigate={onNavigate}
        />
        <TodayMobileSidebar
          followUps={followUps}
          onMarkFollowUpSent={onMarkFollowUpSent}
          markingFollowUpIds={markingFollowUpIds}
          onOpenTariffs={onOpenTariffs}
        />
      </div>
      <ExecutiveOnboardingCard />
    </div>
  );
}

function TodayMobileIntro({
  snapshot,
  onNavigate,
}: Pick<TodayContentProps, 'snapshot' | 'onNavigate'>) {
  return (
    <>
      <TodayReturnBanner
        sinceLastVisit={snapshot.sinceLastVisit}
        digest={snapshot.digest}
        onNavigate={onNavigate}
      />
      <p className="career-today-subtitle">
        Что изменилось с прошлого визита и что решить сегодня.
      </p>
      <CareerDiaryShortcut onNavigate={onNavigate} />
      {snapshot.vacanciesPending ? <TodayPendingNotice /> : null}
    </>
  );
}

function TodayMobileSidebar({
  followUps,
  onMarkFollowUpSent,
  markingFollowUpIds,
  onOpenTariffs,
}: {
  readonly followUps: readonly TodayFollowUp[];
  readonly onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  readonly markingFollowUpIds: ReadonlySet<string>;
  readonly onOpenTariffs?: () => void;
}) {
  return (
    <div className="career-today-side">
      <LinkedinDraftCard onOpenTariffs={onOpenTariffs} />
      <TodayFollowUps
        followUps={followUps}
        onMarkFollowUpSent={onMarkFollowUpSent}
        markingFollowUpIds={markingFollowUpIds}
      />
    </div>
  );
}

function CareerDiaryShortcut({
  onNavigate,
}: {
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  const diary = useCareerDiaryAccess();
  if (diary.state === 'loading') {
    return (
      <p className="career-diary-access-status" role="status">
        Проверяем статус места работы…
      </p>
    );
  }
  if (diary.state === 'error') {
    return (
      <section className="career-diary-access-error">
        <p role="alert">{diary.error ?? 'Не удалось проверить место работы.'}</p>
        <button className="career-btn is-ghost" type="button" onClick={diary.reload}>
          Повторить
        </button>
      </section>
    );
  }
  if (!diary.isVisible || !onNavigate) return null;
  return (
    <button
      className="career-btn is-ghost career-today-diary-shortcut"
      type="button"
      onClick={() => onNavigate('diary')}
    >
      Открыть карьерный дневник
    </button>
  );
}

function sinceHintOf(items: readonly string[]) {
  const extra = items.filter((item) => !/вакан/u.test(item));
  if (extra.length === 0) return null;
  return <p className="career-today-since-hint">{extra.join(' · ')}</p>;
}

function TodayQueueList({
  queue,
  hasConsultantCard,
  consultantAction,
  onAcceptConsultant,
  onDismissConsultant,
  onMarkFollowUpSent,
  markingFollowUpIds,
  onNavigate,
}: {
  queue: readonly TodayQueueItem[];
  hasConsultantCard: boolean;
  consultantAction?: ReasonedCareerAction;
  onAcceptConsultant?: () => void;
  onDismissConsultant?: () => void;
  onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  markingFollowUpIds: ReadonlySet<string>;
  onNavigate?: (view: CareerCabinetView) => void;
}) {
  return (
    <ul className="career-today-list">
      {consultantAction ? (
        <ConsultantQueueCard
          action={consultantAction}
          isFirst={true}
          onAccept={onAcceptConsultant}
          onDismiss={onDismissConsultant}
        />
      ) : null}
      {queue.map((item, index) => (
        <QueueRow
          key={queueKey(item)}
          item={item}
          isFirst={!hasConsultantCard && index === 0}
          onMarkFollowUpSent={onMarkFollowUpSent}
          markingFollowUpIds={markingFollowUpIds}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

function TodayQueue({
  queue,
  sinceLastVisitItems,
  onMarkFollowUpSent,
  markingFollowUpIds,
  consultantAction,
  onAcceptConsultant,
  onDismissConsultant,
  onNavigate,
}: {
  queue: readonly TodayQueueItem[];
  sinceLastVisitItems: readonly string[];
  onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  markingFollowUpIds: ReadonlySet<string>;
  consultantAction?: ReasonedCareerAction;
  onAcceptConsultant?: () => void;
  onDismissConsultant?: () => void;
  onNavigate?: (view: CareerCabinetView) => void;
}) {
  const hasConsultantCard = Boolean(consultantAction);
  const totalCount = queue.length + (hasConsultantCard ? 1 : 0);

  return (
    <section className="career-today-queue" aria-label="Очередь дня">
      <header className="career-today-queue-head">
        <h2>Очередь дня</h2>
        <span className="career-today-hint">
          {pluralRu(totalCount, ['карточка', 'карточки', 'карточек'])} · решение нужно по каждой
        </span>
      </header>
      {sinceHintOf(sinceLastVisitItems)}
      {totalCount === 0 ? (
        <p className="career-today-empty">
          Решений на сегодня нет: подборка разобрана. Новые вакансии появятся здесь сами.
        </p>
      ) : (
        <TodayQueueList
          queue={queue}
          hasConsultantCard={hasConsultantCard}
          consultantAction={consultantAction}
          onAcceptConsultant={onAcceptConsultant}
          onDismissConsultant={onDismissConsultant}
          onMarkFollowUpSent={onMarkFollowUpSent}
          markingFollowUpIds={markingFollowUpIds}
          onNavigate={onNavigate}
        />
      )}
    </section>
  );
}

function ConsultantCardBody({ action }: { action: ReasonedCareerAction }) {
  return (
    <div className="career-today-item-body">
      <span className="career-today-item-kind is-accent">Консультант · Один шаг на сегодня</span>
      <div className="career-today-item-title">{action.headline}</div>
      <div className="career-today-item-rationale">{action.rationale}</div>
      {action.expectedChange ? (
        <div className="career-today-item-effect">
          <span className="career-today-effect-label">Что изменится:</span> {action.expectedChange}
        </div>
      ) : null}
    </div>
  );
}

function ConsultantQueueCard({
  action,
  isFirst,
  onAccept,
  onDismiss,
}: {
  action: ReasonedCareerAction;
  isFirst: boolean;
  onAccept?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <li
      className={`career-today-item career-today-consultant-card${isFirst ? ' is-first' : ''}`}
      data-testid="consultant-queue-card"
    >
      <span className="career-today-item-logo is-consultant">
        <Sparkle size={18} aria-hidden="true" />
      </span>
      <ConsultantCardBody action={action} />
      <span className="career-today-item-fit" />
      <div className="career-today-item-actions">
        <button
          type="button"
          className="career-btn career-btn-primary career-btn-sm career-today-consultant-action"
          onClick={onAccept}
        >
          {action.label}
        </button>
        <button
          type="button"
          className="career-btn-icon career-today-consultant-dismiss"
          aria-label="Отклонить предложение"
          onClick={onDismiss}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function QueueRow({
  item,
  isFirst,
  onMarkFollowUpSent,
  markingFollowUpIds,
  onNavigate,
}: {
  item: TodayQueueItem;
  isFirst: boolean;
  onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  markingFollowUpIds: ReadonlySet<string>;
  onNavigate?: (view: CareerCabinetView) => void;
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
          {(item.eyebrow ?? queueKindLabel(item)).replace(/follow-up/gi, 'Напоминание компании')}
        </span>
        <div className="career-today-item-title">{formatQueueTitle(item.company, item.title)}</div>
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
          onNavigate={onNavigate}
        />
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
  const content =
    ok === null ? (
      <span className="career-today-fit-dot is-unknown" aria-label={title}>
        {label} —
      </span>
    ) : (
      <span className={`career-today-fit-dot${ok ? ' is-yes' : ' is-no'}`}>
        {ok ? label : `${label} —`}
      </span>
    );

  if (title) {
    return <CareerTooltip content={title}>{content}</CareerTooltip>;
  }
  return content;
}

function FollowUpQueueAction({
  item,
  isSaving,
  onMark,
}: {
  item: TodayQueueItem;
  isSaving: boolean;
  onMark: (applicationId: string) => Promise<void>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  if (!item.applicationId) return null;
  return (
    <div className="career-today-followup-buttons">
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm career-today-draft-btn"
        onClick={() => setModalOpen(true)}
      >
        Черновик напоминания
      </button>
      <MarkFollowUpButton applicationId={item.applicationId} isSaving={isSaving} onMark={onMark} />
      {modalOpen ? (
        <CompanyReminderModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onMarkSent={onMark}
          applicationId={item.applicationId}
          company={item.company}
          positionTitle={item.title}
          promisedDate={item.dueAt}
        />
      ) : null}
    </div>
  );
}

function QueueAction({
  item,
  onMarkFollowUpSent,
  markingFollowUpIds,
  onNavigate,
}: {
  item: TodayQueueItem;
  onMarkFollowUpSent: (applicationId: string) => Promise<void>;
  markingFollowUpIds: ReadonlySet<string>;
  onNavigate?: (view: CareerCabinetView) => void;
}) {
  if (item.kind === 'follow_up') {
    return (
      <FollowUpQueueAction
        item={item}
        isSaving={item.applicationId ? markingFollowUpIds.has(item.applicationId) : false}
        onMark={onMarkFollowUpSent}
      />
    );
  }
  if (item.kind === 'interview') {
    return <PrepareInterviewButton item={item} />;
  }
  return (
    <button
      type="button"
      className="career-btn career-btn-secondary career-btn-sm"
      onClick={() => onNavigate?.(queueItemTarget(item))}
    >
      Открыть
    </button>
  );
}

/** «Подготовиться» from «Сегодня» (B251 F5) opens the same interview prep
 * material the tracker card offers — no dedicated prep screen exists yet. */
function PrepareInterviewButton({ item }: { item: TodayQueueItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        onClick={() => setOpen(true)}
      >
        Подготовиться
      </button>
      <InterviewPrepModal
        isOpen={open}
        onClose={() => setOpen(false)}
        vacancy={{
          id: item.applicationId ?? item.clusterId ?? item.title,
          title: item.title,
          company: item.company ?? undefined,
        }}
      />
    </>
  );
}

function FollowUpItemActions({
  item,
  isSaving,
  onMark,
}: {
  item: TodayFollowUp;
  isSaving: boolean;
  onMark: (applicationId: string) => Promise<void>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <div className="career-today-followup-buttons">
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm career-today-draft-btn"
        onClick={() => setModalOpen(true)}
      >
        Черновик
      </button>
      <MarkFollowUpButton applicationId={item.applicationId} isSaving={isSaving} onMark={onMark} />
      {modalOpen ? (
        <CompanyReminderModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onMarkSent={onMark}
          applicationId={item.applicationId}
          company={item.company}
          positionTitle={item.title}
        />
      ) : null}
    </div>
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
    <section className="career-today-followups" aria-label="Напоминания компании по срокам">
      <h2>Напоминания компании по срокам</h2>
      <ul>
        {followUps.map((item) => (
          <li key={item.applicationId} className="career-today-followup-item">
            <span className="career-today-followup-who">
              {formatQueueTitle(item.company, item.title)}
            </span>
            <span className={`career-today-followup-when metric is-${item.status}`}>
              {followUpStatusLabel(item.status)}
            </span>
            {item.status === 'sent' ? null : (
              <FollowUpItemActions
                item={item}
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
  if (item.kind === 'follow_up') return 'Напоминание компании';
  if (item.kind === 'interview') return 'Интервью';
  return 'Ваш ход';
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
