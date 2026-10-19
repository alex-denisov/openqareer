import { useState } from 'react';
import {
  Bell,
  BellSimple,
  ChatsCircle,
  PaperPlaneTilt,
  Target,
  Clock,
  Briefcase,
  ChatCircleDots,
  CheckCircle,
  Info,
  LinkedinLogo,
  ListChecks,
  X,
} from '@phosphor-icons/react';
import './today-desktop.css';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import type { ResumeDraft } from '../resume/resumeTypes';
import { CareerTooltip } from '../shell/CareerTooltip';
import { TodayProfileProgress as TodayProfileProgressView } from './TodayProfileProgress';
import { TodayLinkedinNote } from './TodayLinkedinNote';
import {
  type TodayProfileFocus,
  type TodayQueueItem,
  type TodaySinceLastVisit,
  type TodaySnapshot,
} from './todayApi';
import {
  buildReturningDigestItems,
  consultantTargetView,
  formatQueueTitle,
  queueActionTitle,
  queueDateLabel,
  queueDesktopSubtitle,
  queueKey,
} from './todayFormat';
import { todayFunnelBasis, todayFunnelStages, type TodayFunnelContext } from './todayFunnelData';
import { useCanOpenQueueItem, useOpenQueueItem } from './todayQueueOpen';

export type { TodayFunnelContext } from './todayFunnelData';

interface TodayDesktopContentProps {
  readonly snapshot: TodaySnapshot;
  readonly profileDraft?: ResumeDraft;
  readonly funnelContext?: TodayFunnelContext;
  readonly activeAction?: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onDiscuss?: () => void;
  readonly onPostpone: () => void | Promise<void>;
  readonly postponeBusy?: boolean;
  readonly postponeError?: string;
  readonly onNavigate?: (view: CareerCabinetView) => void;
  readonly onNavigateProfileTarget?: (target: TodayProfileFocus) => void;
  readonly onDiscussQueueItem?: (item: TodayQueueItem) => void;
  readonly queueRemainderLoading?: boolean;
  readonly queueRemainderFailed?: boolean;
  readonly onLoadQueueRemainder?: () => Promise<void>;
  readonly onOpenConnections?: () => void;
}

export function TodayDesktopContent(props: TodayDesktopContentProps) {
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  return (
    <div className="career-today-desktop">
      {!noticeDismissed ? (
        <TodayChangesNotice
          sinceLastVisit={props.snapshot.sinceLastVisit}
          onDismiss={() => setNoticeDismissed(true)}
        />
      ) : null}
      {props.profileDraft ? (
        <TodayProfileProgressView
          draft={props.profileDraft}
          onNavigate={props.onNavigate}
          onNavigateProfileTarget={props.onNavigateProfileTarget}
        />
      ) : null}
      <TodayDecisionSection {...props} />
      <TodayQueueDesktop
        pending={props.snapshot.vacanciesPending}
        queue={props.snapshot.queue}
        queueTotal={props.snapshot.queueTotal ?? props.snapshot.queue.length}
        queueRemainderLoading={props.queueRemainderLoading}
        queueRemainderFailed={props.queueRemainderFailed}
        onLoadQueueRemainder={props.onLoadQueueRemainder}
        onNavigate={props.onNavigate}
        onDiscussQueueItem={props.onDiscussQueueItem}
      />
      <TodayLinkedinNote
        queueSize={props.snapshot.queue.length}
        onOpenConnections={props.onOpenConnections}
      />
      <TodayFunnel snapshot={props.snapshot} context={props.funnelContext} />
    </div>
  );
}

function TodayDecisionSection({
  activeAction,
  onAccept,
  onDiscuss,
  onPostpone,
  postponeBusy = false,
  postponeError,
  onNavigate,
  snapshot,
}: Pick<
  TodayDesktopContentProps,
  | 'snapshot'
  | 'activeAction'
  | 'onAccept'
  | 'onDiscuss'
  | 'onPostpone'
  | 'postponeBusy'
  | 'postponeError'
  | 'onNavigate'
>) {
  if (!activeAction)
    return (
      <TodayNextDecisionUnavailable
        onDiscuss={onDiscuss}
        nothingToDecide={snapshot.queue.length === 0}
        onNavigate={onNavigate}
      />
    );
  return (
    <TodayNextDecision
      action={activeAction}
      onAccept={onAccept}
      onDiscuss={onDiscuss}
      onPostpone={onPostpone}
      postponeBusy={postponeBusy}
      postponeError={postponeError}
      onNavigate={onNavigate}
    />
  );
}

function shortDateTime(value: string | undefined): string | undefined {
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

function changeLabels(sinceLastVisit: TodaySinceLastVisit): readonly string[] {
  const reportedChanges = sinceLastVisit.items.map((item) => item.trim()).filter(Boolean);
  const reportedKinds = new Set(
    reportedChanges.map((item) =>
      /вакан/u.test(item)
        ? 'vacancies'
        : /отклик/u.test(item)
          ? 'applications'
          : /интерв/u.test(item)
            ? 'interview'
            : 'other',
    ),
  );
  const derivedChanges = buildReturningDigestItems({
    since: sinceLastVisit.since,
    newVacanciesCount: sinceLastVisit.newVacanciesCount ?? 0,
    applicationsWaitingOver7Days: sinceLastVisit.applicationsWaitingOver7Days ?? 0,
    nearestInterview: sinceLastVisit.nearestInterview ?? null,
  })
    .filter((item) => !reportedKinds.has(item.id))
    .map((item) => {
      if (item.id !== 'interview' || !sinceLastVisit.nearestInterview) return item.label;
      return `${sinceLastVisit.nearestInterview.company ?? sinceLastVisit.nearestInterview.title} · ${item.label}`;
    });
  return [...reportedChanges, ...derivedChanges];
}

function TodayChangesNotice({
  sinceLastVisit,
  onDismiss,
}: {
  readonly sinceLastVisit: TodaySinceLastVisit;
  readonly onDismiss: () => void;
}) {
  const changes = changeLabels(sinceLastVisit);
  const since = shortDateTime(sinceLastVisit.since ?? undefined);
  if (!changes.length || !since) return null;
  return (
    <section className="career-today-changes" aria-label="Изменения с прошлого визита">
      <BellSimple size="1em" aria-hidden="true" />
      <p>
        <span className="career-today-changes-since">С {since}:</span>
        <span className="career-today-changes-summary">{changes.join(' · ')}</span>
        <button
          className="career-today-changes-link"
          type="button"
          onClick={() => {
            const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            document
              .getElementById('today-queue')
              ?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
          }}
        >
          Смотреть
        </button>
      </p>
      <button
        className="career-today-changes-close"
        type="button"
        aria-label="Скрыть уведомление"
        onClick={onDismiss}
      >
        <X size="1em" aria-hidden="true" />
      </button>
    </section>
  );
}

function actionDestinationLabel(action: ReasonedCareerAction): string {
  if (action.destination === 'career' || action.destination === 'search') return 'Карьера';
  if (action.destination === 'coach') return 'Консультант';
  return 'Профиль';
}

export function actionSourceSummary(action: ReasonedCareerAction): string {
  const sources = [
    ...(action.findingIds.length ? ['профиль'] : []),
    ...(action.roleIds.length || action.marketIds.length ? ['карьерная гипотеза'] : []),
  ];
  return sources.length ? sources.join(' · ') : 'нет проверенных данных';
}

function DecisionReason({
  action,
  onDiscuss,
  onNavigate,
}: {
  readonly action: ReasonedCareerAction;
  readonly onDiscuss?: () => void;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  const isCoachAction = action.destination === 'coach';
  return (
    <ol className="career-today-decision-reasons">
      <li>
        <span aria-hidden="true">1</span>
        <p>
          {action.rationale}{' '}
          {onNavigate || (isCoachAction && onDiscuss) ? (
            <button
              type="button"
              onClick={() =>
                isCoachAction
                  ? onDiscuss?.()
                  : onNavigate?.(consultantTargetView(action.destination))
              }
            >
              {actionDestinationLabel(action)}
            </button>
          ) : null}
        </p>
      </li>
    </ol>
  );
}

function DecisionExpectedChange({ text }: { readonly text: string }) {
  return (
    <p className="career-today-decision-effect">
      <Target size="1em" aria-hidden="true" />
      <span>Откроется: {text}</span>
    </p>
  );
}

function DecisionActions({
  action,
  onAccept,
  onDiscuss,
  onPostpone,
  postponeBusy,
  postponeError,
}: {
  readonly action: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onDiscuss?: () => void;
  readonly onPostpone: () => void | Promise<void>;
  readonly postponeBusy: boolean;
  readonly postponeError?: string;
}) {
  const coachAction = action.destination === 'coach';
  const acceptLabel = coachAction
    ? action.label
    : action.destination === 'profile' || action.destination === 'evidence'
      ? 'Подтвердить факт'
      : action.label;
  return (
    <div className="career-today-decision-actions" aria-busy={postponeBusy || undefined}>
      {!coachAction || onDiscuss ? (
        <button type="button" className="career-btn career-btn-primary" onClick={onAccept}>
          <CheckCircle size="1em" aria-hidden="true" />
          {acceptLabel}
        </button>
      ) : null}
      {onDiscuss && !coachAction ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onDiscuss}>
          <ChatCircleDots size="1em" aria-hidden="true" />
          Обсудить
        </button>
      ) : null}
      <button
        type="button"
        className="career-today-decision-postpone"
        disabled={postponeBusy}
        onClick={() => void onPostpone()}
      >
        {postponeBusy ? 'Сохраняем…' : 'Отложить до завтра'}
      </button>
      {postponeError ? <p role="alert">{postponeError}</p> : null}
    </div>
  );
}

// Макет 1 «Пусто: решения нет»: решения нет и очередь пуста — пути дальше, а не тупик.
function TodayNothingToDecide({
  onDiscuss,
  onNavigate,
}: {
  readonly onDiscuss?: () => void;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  return (
    <section className="career-today-next-decision" aria-label="Следующее решение">
      <p className="career-today-eyebrow">Следующее решение</p>
      <h2 id="today-next-decision-title">{TODAY_NOTHING_TO_DECIDE}</h2>
      <div className="career-today-decision-actions">
        {onNavigate ? (
          <button type="button" className="career-btn" onClick={() => onNavigate('opportunities')}>
            Открыть вакансии
          </button>
        ) : null}
        {onDiscuss ? (
          <button type="button" className="career-today-decision-postpone" onClick={onDiscuss}>
            Обсудить цель
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Текст макета 1 «Пусто: решения нет» — общий для 1440 и 390. */
export const TODAY_NOTHING_TO_DECIDE = 'Сейчас нечего решать. Очередь пуста.';

function TodayNextDecisionUnavailable({
  onDiscuss,
  nothingToDecide,
  onNavigate,
}: {
  readonly onDiscuss?: () => void;
  readonly nothingToDecide: boolean;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  if (nothingToDecide)
    return <TodayNothingToDecide onDiscuss={onDiscuss} onNavigate={onNavigate} />;
  return (
    <section className="career-today-next-decision" aria-label="Следующее решение">
      <p className="career-today-eyebrow">Следующее решение</p>
      <h2 id="today-next-decision-title">Нет проверенного следующего шага</h2>
      <p className="career-today-decision-empty-copy">
        В текущих данных нет основания предложить конкретное действие.
      </p>
      {onDiscuss ? (
        <div className="career-today-decision-actions">
          <button type="button" className="career-btn career-btn-primary" onClick={onDiscuss}>
            Обсудить
          </button>
        </div>
      ) : null}
      <p className="career-today-decision-sources">Источники: нет проверенных данных</p>
    </section>
  );
}

function TodayNextDecision({
  action,
  onAccept,
  onDiscuss,
  onPostpone,
  postponeBusy,
  postponeError,
  onNavigate,
}: {
  readonly action: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onDiscuss?: () => void;
  readonly onPostpone: () => void | Promise<void>;
  readonly postponeBusy: boolean;
  readonly postponeError?: string;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  return (
    <section
      className="career-today-next-decision"
      aria-label="Следующее решение"
      aria-busy={postponeBusy || undefined}
    >
      <p className="career-today-eyebrow">Следующее решение</p>
      <h2 id="today-next-decision-title">{action.headline}</h2>
      <DecisionReason action={action} onDiscuss={onDiscuss} onNavigate={onNavigate} />
      {action.expectedChange ? <DecisionExpectedChange text={action.expectedChange} /> : null}
      <DecisionActions
        action={action}
        onAccept={onAccept}
        onDiscuss={onDiscuss}
        onPostpone={onPostpone}
        postponeBusy={postponeBusy}
        postponeError={postponeError}
      />
      <p className="career-today-decision-sources">
        <Clock size="1em" aria-hidden="true" />
        Источники: {actionSourceSummary(action)}
      </p>
    </section>
  );
}

function queueBadgeLabel(kind: TodayQueueItem['kind']): string {
  if (kind === 'follow_up') return 'Срок ответа';
  if (kind === 'interview') return 'Интервью';
  if (kind === 'candidate_turn' || kind === 'linkedin_post') return 'Одобрение';
  return 'Вакансия';
}

function queueIcon(kind: TodayQueueItem['kind']) {
  if (kind === 'follow_up') return Bell;
  if (kind === 'interview') return ChatsCircle;
  if (kind === 'candidate_turn') return PaperPlaneTilt;
  if (kind === 'linkedin_post') return LinkedinLogo;
  if (kind === 'shortlist') return ListChecks;
  return Briefcase;
}

function queueDeadlineClass(label: string, kind: TodayQueueItem['kind']) {
  return label.includes('просрочено') ? ' is-late' : kind === 'interview' ? ' is-interview' : '';
}

function TodayQueueDesktopRow({
  item,
  onNavigate,
  onDiscussQueueItem,
}: {
  readonly item: TodayQueueItem;
  readonly onNavigate?: (view: CareerCabinetView) => void;
  readonly onDiscussQueueItem?: (item: TodayQueueItem) => void;
}) {
  const ItemIcon = queueIcon(item.kind);
  const openItem = useOpenQueueItem(onNavigate);
  const canOpen = useCanOpenQueueItem(item, onNavigate);
  const actionTitle = queueActionTitle(item);
  const dateLabel = queueDateLabel(item.dueAt, item.kind);
  return (
    <li key={queueKey(item)}>
      <button
        type="button"
        className="career-today-queue-desktop-row"
        aria-label={`Открыть: ${formatQueueTitle(item.company, item.title)}`}
        disabled={!canOpen}
        onClick={() => openItem?.(item)}
      >
        <span className="career-today-queue-desktop-icon">
          <ItemIcon size="1em" aria-hidden="true" />
        </span>
        <span className="career-today-queue-desktop-copy">
          <strong>{actionTitle}</strong>
          <small>{queueDesktopSubtitle(item)}</small>
        </span>
        <span
          className={`career-today-queue-desktop-deadline${queueDeadlineClass(dateLabel, item.kind)}`}
        >
          <span>{queueBadgeLabel(item.kind)}</span>
          <strong>{dateLabel}</strong>
        </span>
        <span aria-hidden="true" />
      </button>
      <button
        type="button"
        className="career-today-queue-discuss"
        aria-label={`Обсудить: ${actionTitle}`}
        disabled={!onDiscussQueueItem}
        onClick={() => onDiscussQueueItem?.(item)}
      >
        <ChatCircleDots size="1em" aria-hidden="true" />
      </button>
    </li>
  );
}

function TodayQueueDesktop({
  queue,
  queueTotal,
  pending,
  queueRemainderLoading,
  queueRemainderFailed,
  onLoadQueueRemainder,
  onNavigate,
  onDiscussQueueItem,
}: {
  readonly queue: readonly TodayQueueItem[];
  readonly queueTotal: number;
  readonly pending?: boolean;
  readonly queueRemainderLoading?: boolean;
  readonly queueRemainderFailed?: boolean;
  readonly onLoadQueueRemainder?: () => Promise<void>;
  readonly onNavigate?: (view: CareerCabinetView) => void;
  readonly onDiscussQueueItem?: (item: TodayQueueItem) => void;
}) {
  const remaining = Math.max(0, queueTotal - queue.length);
  return (
    <section
      id="today-queue"
      className="career-today-queue-desktop"
      aria-label="Очередь дня"
      aria-busy={pending || queueRemainderLoading || undefined}
    >
      <TodayQueueHeader queueTotal={queueTotal} />
      {queue.length ? (
        <TodayQueueRows
          queue={queue}
          onNavigate={onNavigate}
          onDiscussQueueItem={onDiscussQueueItem}
        />
      ) : (
        <p className="career-today-queue-desktop-empty">
          {pending ? 'Загружаем очередь дня…' : 'Очередь дня пуста. Новые задачи появятся здесь.'}
        </p>
      )}
      <TodayQueueRemainderControl
        remaining={remaining}
        loading={queueRemainderLoading}
        failed={queueRemainderFailed}
        onLoad={onLoadQueueRemainder}
      />
    </section>
  );
}

function TodayQueueHeader({ queueTotal }: { readonly queueTotal: number }) {
  return (
    <header className="career-today-queue-desktop-head">
      <div className="career-today-queue-heading">
        <h2>Очередь дня</h2>
        <span className="career-today-queue-count">{queueTotal}</span>
        <CareerTooltip content="Решения, которые ждут вашего действия.">
          <button
            type="button"
            className="career-today-info-button"
            aria-label="О составе очереди дня"
          >
            <Info size="1em" aria-hidden="true" />
          </button>
        </CareerTooltip>
      </div>
    </header>
  );
}

function TodayQueueRows({
  queue,
  onNavigate,
  onDiscussQueueItem,
}: {
  readonly queue: readonly TodayQueueItem[];
  readonly onNavigate?: (view: CareerCabinetView) => void;
  readonly onDiscussQueueItem?: (item: TodayQueueItem) => void;
}) {
  return (
    <ul className="career-today-queue-desktop-list">
      {queue.slice(0, 5).map((item) => (
        <TodayQueueDesktopRow
          key={queueKey(item)}
          item={item}
          onNavigate={onNavigate}
          onDiscussQueueItem={onDiscussQueueItem}
        />
      ))}
    </ul>
  );
}

function TodayQueueRemainderControl({
  remaining,
  loading,
  failed,
  onLoad,
}: {
  readonly remaining: number;
  readonly loading?: boolean;
  readonly failed?: boolean;
  readonly onLoad?: () => Promise<void>;
}) {
  return (
    <>
      {remaining > 0 ? (
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          data-testid="today-desktop-queue-more"
          disabled={!onLoad || loading}
          onClick={() => void onLoad?.()}
        >
          {loading ? 'Загружаем…' : `Показать остальные ${remaining}`}
        </button>
      ) : null}
      {failed ? <p role="alert">Не удалось загрузить остальные карточки очереди.</p> : null}
    </>
  );
}

function TodayFunnelMetric({
  label,
  value,
  last,
  ratio,
  current,
}: {
  readonly label: string;
  readonly value: number | 'unknown';
  readonly last: boolean;
  readonly ratio?: number;
  readonly current: boolean;
}) {
  return (
    <li
      className={current ? 'is-current' : undefined}
      aria-label={value === 'unknown' ? `${label}: нет проверенных данных` : undefined}
    >
      <span className="career-today-funnel-value">{value === 'unknown' ? '—' : value}</span>
      <span className="career-today-funnel-label">{label}</span>
      <svg
        className="career-today-funnel-track"
        viewBox="0 0 100 4"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect className="career-today-funnel-track-bg" width="100" height="4" rx="2" />
        {ratio !== undefined ? (
          <rect className="career-today-funnel-track-fill" width={ratio} height="4" rx="2" />
        ) : null}
      </svg>
      {!last ? <span className="career-today-funnel-separator" aria-hidden="true" /> : null}
    </li>
  );
}

function TodayFunnel({
  snapshot,
  context,
}: {
  readonly snapshot: TodaySnapshot;
  readonly context?: TodayFunnelContext;
}) {
  const stages = todayFunnelStages(snapshot, context);
  const scale = Math.max(
    1,
    ...stages.map((stage) => (typeof stage.value === 'number' ? stage.value : 0)),
  );
  const currentIndex = stages.reduce(
    (last, stage, index) => (typeof stage.value === 'number' && stage.value > 0 ? index : last),
    -1,
  );
  return (
    <section className="career-today-funnel" aria-label="Воронка за 30 дней">
      <header>
        <h2>Воронка за 30 дней</h2>
        <CareerTooltip content="Отклики — по подтверждениям отправки, интервью — по сохранённым датам встреч, ответы и офферы — по стадиям откликов за 30 дней, найдено — по каталогу подбора.">
          <button
            type="button"
            className="career-today-info-button"
            aria-label="Об источнике данных воронки"
          >
            <Info size="1em" aria-hidden="true" />
          </button>
        </CareerTooltip>
        <span className="career-today-funnel-basis">
          <Clock size="1em" aria-hidden="true" />
          {todayFunnelBasis(snapshot, stages)}
        </span>
      </header>
      <ol className="career-today-funnel-list">
        {stages.map((stage, index) => (
          <TodayFunnelMetric
            key={stage.key}
            label={stage.label}
            value={stage.value}
            last={index === stages.length - 1}
            current={index === currentIndex}
            ratio={typeof stage.value === 'number' ? (stage.value / scale) * 100 : undefined}
          />
        ))}
      </ol>
    </section>
  );
}
