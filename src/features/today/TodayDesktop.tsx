import { useState } from 'react';
import {
  BellSimple,
  Briefcase,
  CalendarBlank,
  ChatCircleDots,
  CheckCircle,
  EnvelopeSimple,
  GraduationCap,
  Info,
  ListChecks,
  Plus,
  X,
} from '@phosphor-icons/react';
import './today-desktop.css';
import { pluralRu } from '../../../shared/pluralRu';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import { profileCompleteness } from '../resume/profileCompleteness';
import type { ResumeDraft } from '../resume/resumeTypes';
import { CareerTooltip } from '../shell/CareerTooltip';
import type { TodayQueueItem, TodaySinceLastVisit, TodaySnapshot } from './todayApi';
import {
  buildReturningDigestItems,
  consultantTargetView,
  formatQueueTitle,
  queueItemTarget,
  queueKey,
} from './todayFormat';

export interface TodayFunnelContext {
  readonly found?: number;
  readonly favorites?: number;
  readonly responses?: number;
  readonly offers?: number;
  readonly catalogObservedAt?: string;
}

interface TodayDesktopContentProps {
  readonly snapshot: TodaySnapshot;
  readonly profileDraft?: ResumeDraft;
  readonly funnelContext?: TodayFunnelContext;
  readonly activeAction?: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onDiscuss?: () => void;
  readonly onPostpone: () => void;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}

export function TodayDesktopContent({
  snapshot,
  profileDraft,
  funnelContext,
  activeAction,
  onAccept,
  onDiscuss,
  onPostpone,
  onNavigate,
}: TodayDesktopContentProps) {
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  return (
    <div className="career-today-desktop">
      {!noticeDismissed ? (
        <TodayChangesNotice
          sinceLastVisit={snapshot.sinceLastVisit}
          onDismiss={() => setNoticeDismissed(true)}
        />
      ) : null}
      {profileDraft ? <TodayProfileProgress draft={profileDraft} onNavigate={onNavigate} /> : null}
      {snapshot.vacanciesPending ? <TodayPendingNotice /> : null}
      {activeAction ? (
        <TodayNextDecision
          action={activeAction}
          onAccept={onAccept}
          onDiscuss={onDiscuss}
          onPostpone={onPostpone}
          onNavigate={onNavigate}
        />
      ) : (
        <TodayNextDecisionUnavailable onDiscuss={onDiscuss} />
      )}
      <TodayQueueDesktop queue={snapshot.queue} onNavigate={onNavigate} />
      <TodayFunnel momentum={snapshot.momentum} context={funnelContext} />
    </div>
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

interface TodayProfileProgressAction {
  readonly label: string;
  readonly section: string;
}

function profileProgressActions(draft: ResumeDraft): readonly TodayProfileProgressAction[] {
  const completeness = profileCompleteness(draft);
  const incompleteDates = draft.experience.find(
    (entry) => !entry.startDate || (!entry.current && !entry.endDate),
  );
  return completeness.missingSections.map((section) => {
    if (section === 'Контакты') return { label: 'Указать контакты', section };
    if (section === 'Опыт') {
      return {
        label: incompleteDates?.employer ? `Даты: ${incompleteDates.employer}` : 'Добавить опыт',
        section,
      };
    }
    if (section === 'Курсы') return { label: 'Добавить курсы', section };
    return { label: `Добавить ${section.toLowerCase()}`, section };
  });
}

function ProfileActionIcon({ section }: { readonly section: string }) {
  if (section === 'Контакты') return <EnvelopeSimple size={16} aria-hidden="true" />;
  if (section === 'Опыт') return <CalendarBlank size={16} aria-hidden="true" />;
  if (section === 'Курсы') return <GraduationCap size={16} aria-hidden="true" />;
  return <Plus size={16} aria-hidden="true" />;
}

function TodayProfileProgress({
  draft,
  onNavigate,
}: {
  readonly draft: ResumeDraft;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  const completeness = profileCompleteness(draft);
  if (!completeness.missingSections.length) return null;
  const actions = profileProgressActions(draft);
  const percent = Math.round((completeness.completedCount / completeness.totalCount) * 100);
  return (
    <section className="career-today-profile-progress" aria-label="Полнота профиля">
      <div className="career-today-profile-progress-main">
        <p>
          Профиль готов на <strong>{percent} %</strong>:{' '}
          {pluralRu(actions.length, ['действие', 'действия', 'действий'])}
        </p>
        <div
          className="career-today-profile-meter"
          role="img"
          aria-label={`Профиль готов на ${percent} процентов`}
        >
          <i style={{ inlineSize: `${percent}%` }} />
        </div>
      </div>
      <div className="career-today-profile-actions" aria-label="Что заполнить">
        {actions.map((action) => (
          <button
            key={action.section}
            type="button"
            className="career-btn career-btn-secondary career-btn-sm career-today-profile-action"
            onClick={() => onNavigate?.('profile')}
            disabled={!onNavigate}
          >
            <ProfileActionIcon section={action.section} />
            {action.label}
          </button>
        ))}
      </div>
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
      <CheckCircle size="1em" aria-hidden="true" />
      <span>Откроется: {text}</span>
    </p>
  );
}

function DecisionActions({
  action,
  onAccept,
  onDiscuss,
  onPostpone,
}: {
  readonly action: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onDiscuss?: () => void;
  readonly onPostpone: () => void;
}) {
  const coachAction = action.destination === 'coach';
  const acceptLabel = coachAction
    ? action.label
    : action.destination === 'profile' || action.destination === 'evidence'
      ? 'Подтвердить факт'
      : action.label;
  return (
    <div className="career-today-decision-actions">
      {!coachAction || onDiscuss ? (
        <button type="button" className="career-btn career-btn-primary" onClick={onAccept}>
          {acceptLabel}
        </button>
      ) : null}
      {onDiscuss && !coachAction ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={onDiscuss}>
          Обсудить
        </button>
      ) : null}
      <button type="button" className="career-today-decision-postpone" onClick={onPostpone}>
        Отложить до завтра
      </button>
    </div>
  );
}

function TodayNextDecisionUnavailable({ onDiscuss }: { readonly onDiscuss?: () => void }) {
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
  onNavigate,
}: {
  readonly action: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onDiscuss?: () => void;
  readonly onPostpone: () => void;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  return (
    <section className="career-today-next-decision" aria-label="Следующее решение">
      <p className="career-today-eyebrow">Следующее решение</p>
      <h2 id="today-next-decision-title">{action.headline}</h2>
      <DecisionReason action={action} onDiscuss={onDiscuss} onNavigate={onNavigate} />
      {action.expectedChange ? <DecisionExpectedChange text={action.expectedChange} /> : null}
      <DecisionActions
        action={action}
        onAccept={onAccept}
        onDiscuss={onDiscuss}
        onPostpone={onPostpone}
      />
      <p className="career-today-decision-sources">Источники: {actionSourceSummary(action)}</p>
    </section>
  );
}

function queueDateLabel(value: string | null, kind: TodayQueueItem['kind']): string {
  if (!value) return kind === 'candidate_turn' ? 'ждёт вас' : 'срок не указан';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'дата неизвестна';
  const dateLabel = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(
    date,
  );
  const delta = date.getTime() - Date.now();
  if (delta < 0) return `до ${dateLabel}, просрочено`;
  if (kind === 'interview') {
    const days = Math.ceil(delta / 86_400_000);
    return days === 0
      ? `${dateLabel}, сегодня`
      : `${dateLabel}, через ${pluralRu(days, ['день', 'дня', 'дней'])}`;
  }
  return `до ${dateLabel}`;
}

function queueBadgeLabel(kind: TodayQueueItem['kind']): string {
  if (kind === 'follow_up') return 'Срок ответа';
  if (kind === 'interview') return 'Интервью';
  if (kind === 'candidate_turn') return 'Одобрение';
  return 'Вакансия';
}

function queueIcon(kind: TodayQueueItem['kind']) {
  if (kind === 'follow_up') return BellSimple;
  if (kind === 'interview') return CalendarBlank;
  if (kind === 'candidate_turn') return CheckCircle;
  if (kind === 'shortlist') return ListChecks;
  return Briefcase;
}

function TodayQueueDesktopRow({
  item,
  onNavigate,
}: {
  readonly item: TodayQueueItem;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  const ItemIcon = queueIcon(item.kind);
  const title = formatQueueTitle(item.company, item.title);
  const subtitle = item.eyebrow?.replace(/follow-up/giu, 'Напоминание компании');
  return (
    <li key={queueKey(item)}>
      <button
        type="button"
        className="career-today-queue-desktop-row"
        aria-label={`Открыть: ${title}`}
        disabled={!onNavigate}
        onClick={() => onNavigate?.(queueItemTarget(item))}
      >
        <span className="career-today-queue-desktop-icon">
          <ItemIcon size="1em" aria-hidden="true" />
        </span>
        <span className="career-today-queue-desktop-copy">
          <strong>{title}</strong>
          <small>{[item.company, subtitle].filter(Boolean).join(' · ')}</small>
        </span>
        <span className="career-today-queue-desktop-deadline">
          <span>{queueBadgeLabel(item.kind)}</span>
          <strong>{queueDateLabel(item.dueAt, item.kind)}</strong>
        </span>
        <ChatCircleDots size="1em" aria-hidden="true" />
      </button>
    </li>
  );
}

function TodayQueueDesktop({
  queue,
  onNavigate,
}: {
  readonly queue: readonly TodayQueueItem[];
  readonly onNavigate?: (view: CareerCabinetView) => void;
}) {
  return (
    <section id="today-queue" className="career-today-queue-desktop" aria-label="Очередь дня">
      <header className="career-today-queue-desktop-head">
        <div>
          <h2>Очередь дня</h2>
          <span className="career-today-queue-count">{queue.length}</span>
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
      {queue.length ? (
        <ul className="career-today-queue-desktop-list">
          {queue.map((item) => (
            <TodayQueueDesktopRow key={queueKey(item)} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : (
        <p className="career-today-queue-desktop-empty">
          Очередь дня пуста. Новые задачи появятся здесь.
        </p>
      )}
    </section>
  );
}

function TodayFunnelMetric({
  label,
  value,
  last,
}: {
  readonly label: string;
  readonly value: number | 'unknown';
  readonly last: boolean;
}) {
  return (
    <li>
      <span className="career-today-funnel-value">{value === 'unknown' ? '—' : value}</span>
      <span className="career-today-funnel-label">{label}</span>
      {value === 'unknown' ? (
        <span className="career-today-funnel-unknown">Нет проверенных данных</span>
      ) : null}
      <span className="career-today-funnel-track" aria-hidden="true" />
      {!last ? (
        <span className="career-today-funnel-separator" aria-hidden="true">
          ›
        </span>
      ) : null}
    </li>
  );
}

function TodayFunnel({
  momentum,
  context,
}: {
  readonly momentum: TodaySnapshot['momentum'];
  readonly context?: TodayFunnelContext;
}) {
  const metrics = momentum?.windows['30d'];
  const items: readonly { label: string; value: number | 'unknown' }[] = [
    { label: 'Найдено', value: context?.found ?? 'unknown' },
    { label: 'В избранном', value: context?.favorites ?? 'unknown' },
    { label: 'Откликов', value: metrics?.applied ?? 'unknown' },
    { label: 'Ответов', value: context?.responses ?? metrics?.screenings ?? 'unknown' },
    { label: 'Интервью', value: metrics?.interviews ?? 'unknown' },
    { label: 'Офферов', value: context?.offers ?? 'unknown' },
  ];
  return (
    <section className="career-today-funnel" aria-label="Воронка за 30 дней">
      <TodayFunnelHeader momentum={momentum} catalogObservedAt={context?.catalogObservedAt} />
      <ol className="career-today-funnel-list">
        {items.map((item, index) => (
          <TodayFunnelMetric
            key={item.label}
            label={item.label}
            value={item.value}
            last={index === items.length - 1}
          />
        ))}
      </ol>
    </section>
  );
}

function TodayFunnelHeader({
  momentum,
  catalogObservedAt,
}: {
  readonly momentum: TodaySnapshot['momentum'];
  readonly catalogObservedAt?: string;
}) {
  const metrics = momentum?.windows['30d'];
  const sampleCount = typeof metrics?.applied === 'number' ? metrics.applied : undefined;
  const calculationDate = shortDateTime(momentum?.calculatedAt);
  const catalogDate = shortDateTime(catalogObservedAt);
  const basis =
    [
      sampleCount === undefined
        ? undefined
        : `n = ${sampleCount} откликов${calculationDate ? `, ${calculationDate}` : ''}`,
      catalogDate ? `каталог на ${catalogDate}` : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || 'Нет проверенных данных';
  return (
    <header>
      <h2>Воронка за 30 дней</h2>
      <CareerTooltip content="Часть метрик пока не имеет проверенного источника и показана как неизвестная.">
        <button type="button" className="career-today-info-button" aria-label="О данных воронки">
          <Info size="1em" aria-hidden="true" />
        </button>
      </CareerTooltip>
      <span className="career-today-funnel-basis">{basis}</span>
    </header>
  );
}

function TodayPendingNotice() {
  return (
    <p className="career-today-pending">
      <Info size={16} aria-hidden="true" />
      Считаем вашу подборку — секунду. Если очередь пуста дольше минуты, откройте «Вакансии».
    </p>
  );
}
