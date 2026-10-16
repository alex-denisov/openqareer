import { useId, useState } from 'react';
import {
  Bell,
  BookmarkSimple,
  Briefcase,
  CaretDown,
  CaretRight,
  CheckCircle,
  ChatCircle,
  ClockCountdown,
  LinkedinLogo,
  PaperPlaneTilt,
  UserCircle,
} from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import {
  deferConsultantActionUntilTomorrow,
  isConsultantActionResolved,
  resolveConsultantAction,
} from './consultantActionStorage';
import {
  selectTodayDecision,
  type TodayFollowUp,
  type TodayQueueItem,
  type TodaySnapshot,
} from './todayApi';
import { TodayDesktopContent, actionSourceSummary, type TodayFunnelContext } from './TodayDesktop';
export type { TodayFunnelContext } from './TodayDesktop';
import {
  consultantTargetView,
  followUpStatusLabel,
  formatQueueTitle,
  queueActionTitle,
  queueItemTarget,
  queueKey,
} from './todayFormat';
export { consultantTargetView, queueItemTarget } from './todayFormat';
import { profileCompleteness } from '../resume/profileCompleteness';
import type { ResumeDraft } from '../resume/resumeTypes';
import './today-mobile.css';

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

function selectedDecisionAction(snapshot: TodaySnapshot): ReasonedCareerAction | undefined {
  if (snapshot.todayDecisionSelection?.resolution !== 'accepted') return undefined;
  const item = snapshot.queue.find(
    (entry) =>
      entry.applicationId === snapshot.todayDecisionSelection?.applicationId &&
      entry.kind === 'follow_up',
  );
  if (!item) return undefined;
  return {
    revision: 'career-action-policy-v1-2026-08-07',
    type: 'decision',
    destination: 'coach',
    headline: queueActionTitle(item),
    label: 'Открыть отклик',
    rationale: item.eyebrow ?? 'Задача из вашей очереди дня.',
    expectedChange: 'Откроются отклики, чтобы подготовить напоминание.',
    findingIds: [],
    roleIds: [],
    marketIds: [],
    alternatives: [],
    approvalBoundary: 'Напоминание отправляется только после вашего подтверждения.',
  };
}

export function TodayScreen({
  snapshot,
  loading,
  failed,
  onRetry,
  candidateId,
  consultantAction,
  profileDraft,
  funnelContext,
  onNavigate,
  onOpenExpert,
}: TodayScreenProps) {
  const { activeAction, onAccept, onPostpone } = useTodayConsultantAction({
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
      activeAction={selectedDecisionAction(snapshot) ?? activeAction}
      onAccept={selectedDecisionAction(snapshot) ? () => onNavigate?.('responses') : onAccept}
      onPostpone={
        snapshot.todayDecisionSelection?.resolution === 'accepted'
          ? () => {
              void selectTodayDecision(
                snapshot.todayDecisionSelection!.applicationId,
                'dismissed',
              ).catch(() => onRetry());
            }
          : onPostpone
      }
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
  readonly onPostpone: () => void;
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
  onPostpone,
  onOpenExpert,
  onNavigate,
  profileDraft,
  funnelContext,
}: Pick<
  TodayContentProps,
  | 'snapshot'
  | 'activeAction'
  | 'onAccept'
  | 'onPostpone'
  | 'onOpenExpert'
  | 'onNavigate'
  | 'profileDraft'
  | 'funnelContext'
>) {
  return (
    <div className="career-today-mobile pm tm">
      <TodayMobileDecision
        action={activeAction}
        onAccept={onAccept}
        onPostpone={onPostpone}
        onOpenExpert={onOpenExpert}
      />
      <TodayMobileQueue
        queue={snapshot.queue}
        followUps={snapshot.followUps}
        onNavigate={onNavigate}
      />
      <TodayMobileFunnel snapshot={snapshot} context={funnelContext} />
      <TodayMobileProfileRow profileDraft={profileDraft} onNavigate={onNavigate} />
    </div>
  );
}

function TodayMobileReasons({
  action,
  open,
  id,
}: {
  readonly action: ReasonedCareerAction;
  readonly open: boolean;
  readonly id: string;
}) {
  return (
    <ol className="tm-reasons" id={id} hidden={!open}>
      <li>
        <span className="num-badge" aria-hidden="true">
          1
        </span>
        <span>{action.rationale}</span>
      </li>
      <li className="tm-src">Источники: {actionSourceSummary(action)}</li>
    </ol>
  );
}

function TodayMobileDecision({
  action,
  onAccept,
  onPostpone,
  onOpenExpert,
}: {
  readonly action?: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onPostpone: () => void;
  readonly onOpenExpert?: () => void;
}) {
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const reasonsId = useId();
  return (
    <section className="tm-hero" aria-label="Следующее решение">
      <p className="tm-eyebrow">Следующее решение</p>
      <h2>{action?.headline ?? 'Нет проверенного следующего шага'}</h2>
      <p className="tm-effect">
        {action?.expectedChange ?? 'В текущих данных нет основания предложить конкретное действие.'}
      </p>
      {action ? (
        <>
          <button className="pm-cta tm-main" type="button" onClick={onAccept}>
            <CheckCircle aria-hidden="true" weight="regular" />
            {action.label}
          </button>
          <button className="pm-text tm-later" type="button" onClick={onPostpone}>
            Отложить до завтра
          </button>
          <button
            className="tm-why"
            type="button"
            aria-expanded={reasonsOpen}
            aria-controls={reasonsId}
            onClick={() => setReasonsOpen((open) => !open)}
          >
            Почему это решение <CaretDown aria-hidden="true" weight="regular" />
          </button>
          <TodayMobileReasons action={action} open={reasonsOpen} id={reasonsId} />
        </>
      ) : onOpenExpert ? (
        <button className="tm-why" type="button" onClick={onOpenExpert}>
          Обсудить <CaretRight aria-hidden="true" weight="regular" />
        </button>
      ) : (
        <p className="pm-foot">Источники: нет проверенных данных</p>
      )}
    </section>
  );
}

function TodayMobileQueue({
  queue,
  followUps,
  onNavigate,
}: {
  readonly queue: readonly TodayQueueItem[];
  readonly followUps: readonly TodayFollowUp[];
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  const visibleQueue = queue.slice(0, 4);
  return (
    <section className="pm-group" aria-label="Очередь дня">
      <h3 className="pm-cap">Очередь дня</h3>
      {visibleQueue.length ? (
        <ul className="pm-list">
          {visibleQueue.map((item) => (
            <TodayMobileQueueRow
              key={queueKey(item)}
              item={item}
              followUps={followUps}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : (
        <p className="pm-empty">Очередь дня пуста. Новые задачи появятся здесь.</p>
      )}
      <p className="pm-foot">Только то, у чего есть срок или что ждёт вашего ответа.</p>
    </section>
  );
}

function TodayMobileQueueRow({
  item,
  followUps,
  onNavigate,
}: {
  readonly item: TodayQueueItem;
  readonly followUps: readonly TodayFollowUp[];
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  const isWarn = isOverdueMobileQueueItem(item, followUps);
  return (
    <li>
      <button
        className={`pm-row${isWarn ? ' is-warn' : ''}`}
        type="button"
        aria-label={`Открыть: ${formatQueueTitle(item.company, item.title)}`}
        data-testid="today-mobile-queue-row"
        disabled={!onNavigate}
        onClick={() => onNavigate?.(queueItemTarget(item))}
      >
        <span className="pm-ico">
          <TodayMobileQueueIcon item={item} />
        </span>
        <span className="pm-main">
          <b>{queueActionTitle(item)}</b>
          <small>{todayMobileQueueSubtitle(item, followUps)}</small>
        </span>
        <CaretRight className="pm-chev" aria-hidden="true" weight="regular" />
      </button>
    </li>
  );
}

function isOverdueMobileQueueItem(
  item: TodayQueueItem,
  followUps: readonly TodayFollowUp[],
): boolean {
  const followUp = followUps.find((entry) => entry.applicationId === item.applicationId);
  if (followUp) return followUp.status === 'overdue';
  const dueAt = item.dueAt ? Date.parse(item.dueAt) : Number.NaN;
  return Number.isFinite(dueAt) && dueAt < Date.now();
}

function todayMobileQueueSubtitle(
  item: TodayQueueItem,
  followUps: readonly TodayFollowUp[],
): string {
  const followUp = followUps.find((entry) => entry.applicationId === item.applicationId);
  const status = followUp ? followUpStatusLabel(followUp.status) : undefined;
  const eyebrow = item.eyebrow?.replace(/follow-up/giu, 'Напоминание компании');
  const detail = eyebrow ?? queueKindLabel(item);
  return [todayMobileQueueCompany(item), detail, status].filter(Boolean).join(' · ');
}

function todayMobileQueueCompany(item: TodayQueueItem): string {
  const title = formatQueueTitle(item.company, item.title);
  const suffix = ` — ${item.title}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : 'Компания не указана';
}

function TodayMobileQueueIcon({ item }: { readonly item: TodayQueueItem }) {
  const sourceText = `${item.company ?? ''} ${item.eyebrow ?? ''}`.toLocaleLowerCase();
  if (sourceText.includes('linkedin')) {
    return <LinkedinLogo aria-hidden="true" weight="regular" />;
  }
  if (item.kind === 'follow_up') return <Bell aria-hidden="true" weight="regular" />;
  if (item.kind === 'interview') return <ChatCircle aria-hidden="true" weight="regular" />;
  if (item.kind === 'candidate_turn') return <PaperPlaneTilt aria-hidden="true" weight="regular" />;
  if (item.kind === 'shortlist') return <BookmarkSimple aria-hidden="true" weight="regular" />;
  return <Briefcase aria-hidden="true" weight="regular" />;
}

function queueKindLabel(item: TodayQueueItem): string {
  if (item.kind === 'new_vacancy') return 'Новая вакансия';
  if (item.kind === 'shortlist') return 'Из подборки';
  if (item.kind === 'follow_up') return 'Напоминание компании';
  if (item.kind === 'interview') return 'Интервью';
  return 'Ваш ход';
}

interface TodayMobileFunnelMetric {
  readonly label: string;
  readonly value: number | 'unknown';
}

function todayMobileFunnelMetrics(
  snapshot: TodaySnapshot,
  context?: TodayFunnelContext,
): readonly TodayMobileFunnelMetric[] {
  const metrics = snapshot.momentum?.windows['30d'];
  return [
    { label: 'Избранное', value: context?.favorites ?? 'unknown' },
    { label: 'Отклики', value: metrics?.applied ?? 'unknown' },
    { label: 'Ответы', value: context?.responses ?? metrics?.screenings ?? 'unknown' },
    { label: 'Интервью', value: metrics?.interviews ?? 'unknown' },
  ];
}

function TodayMobileFunnel({
  snapshot,
  context,
}: {
  readonly snapshot: TodaySnapshot;
  readonly context?: TodayFunnelContext;
}) {
  const items = todayMobileFunnelMetrics(snapshot, context);
  const currentStage = items.reduce(
    (last, item, index) => (typeof item.value === 'number' && item.value > 0 ? index : last),
    -1,
  );
  return (
    <section className="pm-group" aria-label="Воронка за 30 дней">
      <h3 className="pm-cap">Воронка за 30 дней</h3>
      <div className="tm-funnel" role="list">
        {items.map((item, index) => (
          <div
            className={index === currentStage ? 'is-here' : undefined}
            key={item.label}
            role="listitem"
            aria-current={index === currentStage ? 'step' : undefined}
            aria-label={
              item.value === 'unknown'
                ? `${item.label}: Нет проверенных данных`
                : `${item.label}: ${item.value}`
            }
          >
            <b className="num">{metricText(item.value)}</b>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <p className="pm-foot">{todayMobileFunnelBasis(snapshot, context, items)}</p>
    </section>
  );
}

function todayMobileFunnelBasis(
  snapshot: TodaySnapshot,
  context: TodayFunnelContext | undefined,
  items: readonly TodayMobileFunnelMetric[],
): string {
  const applications = snapshot.momentum?.windows['30d'].applied ?? 'unknown';
  const missing = items.filter((item) => item.value === 'unknown').map((item) => item.label);
  if (context?.found === undefined) missing.push('каталог');
  if (context?.offers === undefined) missing.push('офферы');
  const catalogDate = formatTodayMobileDate(context?.catalogObservedAt) ?? 'дата неизвестна';
  const calculationDate =
    formatTodayMobileDate(snapshot.momentum?.calculatedAt) ?? 'дата неизвестна';
  const sample = typeof applications === 'number' ? ` (n = ${applications})` : '';
  return [
    `Найдено в каталоге: ${metricText(context?.found)}. Офферов пока ${metricText(context?.offers)}; каталог на ${catalogDate}.`,
    `Откликов: ${metricText(applications)}${sample}. Данные на ${calculationDate}.`,
    missing.length ? `Нет проверенных данных: ${[...new Set(missing)].join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function metricText(value: number | 'unknown' | undefined): string {
  return typeof value === 'number' ? String(value) : '—';
}

function formatTodayMobileDate(value: string | undefined): string | undefined {
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

function TodayMobileProfileRow({
  profileDraft,
  onNavigate,
}: {
  readonly profileDraft?: ResumeDraft;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  const actionCount = profileDraft
    ? profileCompleteness(profileDraft).missingSections.length
    : undefined;
  const subtitle =
    actionCount === undefined
      ? 'Контакты, даты, курсы · нет проверенных данных'
      : `Контакты, даты, курсы · ${pluralRu(actionCount, ['действие', 'действия', 'действий'])}`;
  return (
    <section className="pm-group" aria-label="Дополнить профиль">
      <div className="pm-list">
        <button
          className="pm-row"
          type="button"
          disabled={!onNavigate}
          onClick={() => onNavigate?.('profile')}
          aria-label={`Перейти в профиль. ${subtitle}`}
        >
          <span className="pm-ico">
            <UserCircle aria-hidden="true" weight="regular" />
          </span>
          <span className="pm-main">
            <b>Дополнить профиль</b>
            <small>{subtitle}</small>
          </span>
          <CaretRight className="pm-chev" aria-hidden="true" weight="regular" />
        </button>
      </div>
    </section>
  );
}

function TodaySkeleton() {
  return (
    <div className="career-today" aria-busy="true" aria-label="Читаем очередь дня">
      <div className="today-loading-mobile pm tm" aria-hidden="true">
        <div className="tm-hero today-loading-hero">
          <span className="today-loading-bar is-short" />
          <span className="today-loading-bar is-title" />
          <span className="today-loading-bar is-copy" />
          <span className="today-loading-bar is-button" />
          <span className="today-loading-bar is-link" />
          <span className="today-loading-bar is-link" />
        </div>
        <section className="pm-group">
          <span className="career-skeleton-line is-short" />
          <div className="pm-list">
            <div className="today-loading-row is-tall" />
            <div className="today-loading-row" />
            <div className="today-loading-row" />
            <div className="today-loading-row" />
          </div>
          <span className="career-skeleton-line is-wide" />
        </section>
        <section className="pm-group">
          <span className="career-skeleton-line is-short" />
          <div className="tm-funnel today-loading-funnel" />
          <span className="career-skeleton-line is-wide" />
        </section>
        <div className="pm-list">
          <div className="today-loading-row" />
        </div>
      </div>
      <div className="today-loading-desktop">
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
