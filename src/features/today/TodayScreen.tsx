import { useId, useMemo, useState } from 'react';
import {
  Briefcase,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  UserCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { NavigationOptions } from '../shell/pathIndicator';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import { todayDecisionAction } from '../next-action/teamSizeAction';
import {
  isConsultantActionResolved,
  resolveConsultantAction,
  todayActionId,
} from './consultantActionStorage';
import {
  deferTodayAction,
  type TodayProfileFocus,
  type TodayQueueItem,
  type TodaySnapshot,
} from './todayApi';
import { TodayLinkedinNote } from './TodayLinkedinNote';
import { todayDecisionOverride, type TodayDiaryDecisionProp } from './todayDecisionOverride';
import {
  TODAY_NOTHING_TO_DECIDE,
  TodayDesktopContent,
  actionSourceSummary,
  decisionAcceptLabel,
} from './TodayDesktop';
import {
  todayFunnelFootnote,
  todayFunnelStages,
  type TodayFunnelContext,
  type TodayFunnelStage,
} from './todayFunnelData';
import { TodayOpenAutomationProvider } from './todayQueueOpen';

import { TodayMobileQueue, type TodayQueueRemainderProps } from './TodayMobileQueue';
export type { TodayFunnelContext } from './todayFunnelData';
import { consultantTargetView } from './todayFormat';
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
  readonly queueRemainderLoading?: boolean;
  readonly queueRemainderFailed?: boolean;
  readonly onLoadQueueRemainder?: () => Promise<void>;
  readonly onOpenTariffs?: () => void;
  readonly onOpenAutomation?: () => void;
  readonly onOpenExpert?: () => void;
  readonly onOpenConnections?: () => void;
  /** Решение дня из карьерного дневника (макет 1 «Вы работаете»). */
  readonly diaryDecision?: TodayDiaryDecisionProp;
  readonly onDiscussQueueItem?: (item: TodayQueueItem) => void;
  readonly onNavigate?: (view: CareerCabinetView, options?: NavigationOptions) => void;
  readonly onNavigateProfileTarget?: (target: TodayProfileFocus) => void;
  readonly onNavigateProfileAction?: (action: ReasonedCareerAction) => void;
}

function useTodayConsultantAction({
  candidateId,
  snapshot,
  consultantAction,
  onNavigate,
  onOpenExpert,
  onNavigateProfileAction,
}: {
  candidateId?: string;
  snapshot: TodaySnapshot | null;
  consultantAction?: ReasonedCareerAction;
  onNavigate?: (view: CareerCabinetView, options?: NavigationOptions) => void;
  onOpenExpert?: () => void;
  onNavigateProfileAction?: (action: ReasonedCareerAction) => void;
}) {
  const [resolvedActionKey, setResolvedActionKey] = useState<string | null>(null);
  const [postponeBusy, setPostponeBusy] = useState(false);
  const [postponeError, setPostponeError] = useState<string>();
  const actionKey = consultantAction ? todayActionId(consultantAction) : null;
  const activeAction = visibleConsultantAction(
    candidateId,
    snapshot,
    consultantAction,
    actionKey,
    resolvedActionKey,
  );

  const onAccept = () =>
    acceptConsultantAction(
      candidateId,
      consultantAction,
      actionKey,
      onNavigate,
      onOpenExpert,
      onNavigateProfileAction,
      setResolvedActionKey,
    );
  const onDismiss = () =>
    dismissConsultantAction(candidateId, consultantAction, actionKey, setResolvedActionKey);
  const onPostpone = async () => {
    if (!consultantAction || !actionKey || postponeBusy) return;
    setPostponeBusy(true);
    setPostponeError(undefined);
    const saved = await saveTodayActionDeferral(actionKey);
    if (saved) setResolvedActionKey(actionKey);
    else setPostponeError('Не удалось сохранить перенос. Повторите попытку.');
    setPostponeBusy(false);
  };

  return { activeAction, onAccept, onDismiss, onPostpone, postponeBusy, postponeError };
}

function visibleConsultantAction(
  candidateId: string | undefined,
  snapshot: TodaySnapshot | null,
  action: ReasonedCareerAction | undefined,
  actionKey: string | null,
  resolvedActionKey: string | null,
): ReasonedCareerAction | undefined {
  if (!action || !actionKey || resolvedActionKey === actionKey) return undefined;
  if (isConsultantActionResolved(candidateId, action)) return undefined;
  return snapshot?.todayActionDeferral?.actionId === actionKey ? undefined : action;
}

function acceptConsultantAction(
  candidateId: string | undefined,
  action: ReasonedCareerAction | undefined,
  actionKey: string | null,
  onNavigate: ((view: CareerCabinetView, options?: NavigationOptions) => void) | undefined,
  onOpenExpert: (() => void) | undefined,
  onNavigateProfileAction: ((action: ReasonedCareerAction) => void) | undefined,
  setResolvedActionKey: (key: string | null) => void,
): void {
  if (!action || !actionKey) return;
  if (action.destination === 'coach') {
    onOpenExpert?.();
    return;
  }
  resolveConsultantAction(candidateId, action, 'accepted');
  setResolvedActionKey(actionKey);
  if (action.destination === 'profile' && onNavigateProfileAction) {
    onNavigateProfileAction(action);
    return;
  }
  onNavigate?.(consultantTargetView(action.destination));
}

function dismissConsultantAction(
  candidateId: string | undefined,
  action: ReasonedCareerAction | undefined,
  actionKey: string | null,
  setResolvedActionKey: (key: string | null) => void,
): void {
  if (!action || !actionKey) return;
  resolveConsultantAction(candidateId, action, 'dismissed');
  setResolvedActionKey(actionKey);
}

async function saveTodayActionDeferral(actionKey: string): Promise<boolean> {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    await deferTodayAction(actionKey, timeZone);
    return true;
  } catch {
    return false;
  }
}

export function TodayScreen(props: TodayScreenProps) {
  const teamSizeDecision = props.snapshot?.teamSizeDecision;
  const consultantAction = useMemo(
    () => todayDecisionAction(teamSizeDecision, props.consultantAction),
    [teamSizeDecision, props.consultantAction],
  );
  const actionState = useTodayConsultantAction({
    candidateId: props.candidateId,
    snapshot: props.snapshot,
    consultantAction,
    onNavigate: props.onNavigate,
    onOpenExpert: props.onOpenExpert,
    onNavigateProfileAction: props.onNavigateProfileAction,
  });

  if (props.failed) return <TodayError onRetry={props.onRetry} />;
  if (props.loading && !props.snapshot) return <TodaySkeleton />;
  const contentProps = todayContentProps(props, actionState);
  return contentProps ? (
    <TodayOpenAutomationProvider value={props.onOpenAutomation}>
      <TodayContent {...contentProps} />
    </TodayOpenAutomationProvider>
  ) : null;
}

function todayContentProps(
  props: TodayScreenProps,
  actionState: ReturnType<typeof useTodayConsultantAction>,
): TodayContentProps | null {
  const { snapshot } = props;
  if (!snapshot) return null;
  const override = todayDecisionOverride(snapshot, props);
  return {
    snapshot,
    activeAction: override?.action ?? actionState.activeAction,
    onAccept: override?.onAccept ?? actionState.onAccept,
    onPostpone: override?.onPostpone ?? actionState.onPostpone,
    postponeBusy: override ? false : actionState.postponeBusy,
    postponeError: override ? undefined : actionState.postponeError,
    queueRemainderLoading: props.queueRemainderLoading,
    queueRemainderFailed: props.queueRemainderFailed,
    onLoadQueueRemainder: props.onLoadQueueRemainder,
    onNavigate: props.onNavigate,
    onOpenExpert: props.onOpenExpert,
    onOpenConnections: props.onOpenConnections,
    onDiscussQueueItem: props.onDiscussQueueItem,
    onNavigateProfileTarget: props.onNavigateProfileTarget,
    profileDraft: props.profileDraft,
    funnelContext: props.funnelContext,
  };
}

interface TodayContentProps {
  readonly snapshot: TodaySnapshot;
  readonly profileDraft?: ResumeDraft;
  readonly funnelContext?: TodayFunnelContext;
  readonly onOpenExpert?: () => void;
  readonly onOpenConnections?: () => void;
  readonly onDiscussQueueItem?: (item: TodayQueueItem) => void;
  readonly activeAction?: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onPostpone: () => void | Promise<void>;
  readonly postponeBusy: boolean;
  readonly postponeError?: string;
  readonly queueRemainderLoading?: boolean;
  readonly queueRemainderFailed?: boolean;
  readonly onLoadQueueRemainder?: () => Promise<void>;
  readonly onNavigate?: (view: CareerCabinetView, options?: NavigationOptions) => void;
  readonly onNavigateProfileTarget?: (target: TodayProfileFocus) => void;
}

function TodayContent(props: TodayContentProps) {
  return (
    <div className="career-today">
      <TodayMobileContent
        {...props}
        queueRemainder={{
          loading: props.queueRemainderLoading,
          failed: props.queueRemainderFailed,
          onLoad: props.onLoadQueueRemainder,
        }}
      />
      <TodayDesktopContent
        snapshot={props.snapshot}
        profileDraft={props.profileDraft}
        funnelContext={props.funnelContext}
        activeAction={props.activeAction}
        onAccept={props.onAccept}
        onDiscuss={props.onOpenExpert}
        onPostpone={props.onPostpone}
        postponeBusy={props.postponeBusy}
        postponeError={props.postponeError}
        onNavigate={props.onNavigate}
        onNavigateProfileTarget={props.onNavigateProfileTarget}
        onDiscussQueueItem={props.onDiscussQueueItem}
        queueRemainderLoading={props.queueRemainderLoading}
        queueRemainderFailed={props.queueRemainderFailed}
        onLoadQueueRemainder={props.onLoadQueueRemainder}
        onOpenConnections={props.onOpenConnections}
      />
    </div>
  );
}

function linkedinNoteProps(snapshot: TodaySnapshot, onOpenConnections?: () => void) {
  return {
    queueSize: snapshot.queue.length,
    connectedSources: snapshot.connectedSources,
    onOpenConnections,
  };
}

function TodayMobileContent({
  snapshot,
  activeAction,
  onAccept,
  onPostpone,
  postponeBusy,
  postponeError,
  onOpenExpert,
  onNavigate,
  profileDraft,
  funnelContext,
  onOpenConnections,
  queueRemainder,
}: { readonly queueRemainder: TodayQueueRemainderProps } & Pick<
  TodayContentProps,
  | 'onOpenConnections'
  | 'snapshot'
  | 'activeAction'
  | 'onAccept'
  | 'onPostpone'
  | 'postponeBusy'
  | 'postponeError'
  | 'onOpenExpert'
  | 'onNavigate'
  | 'profileDraft'
  | 'funnelContext'
>) {
  return (
    <div className="career-today-mobile pm tm">
      <TodayMobileDecision
        nothingToDecide={!activeAction && snapshot.queue.length === 0}
        onNavigate={onNavigate}
        action={activeAction}
        onAccept={onAccept}
        onPostpone={onPostpone}
        postponeBusy={postponeBusy}
        postponeError={postponeError}
        onOpenExpert={onOpenExpert}
      />
      <TodayMobileQueue snapshot={snapshot} onNavigate={onNavigate} remainder={queueRemainder} />
      <TodayLinkedinNote {...linkedinNoteProps(snapshot, onOpenConnections)} />
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
      {(action.reasons ?? [{ text: action.rationale }]).map((reason, index) => (
        <li key={reason.text}>
          <span className="num-badge" aria-hidden="true">
            {index + 1}
          </span>
          <span>{reason.mobileText ?? reason.text}</span>
        </li>
      ))}
      <li className="tm-src">Источники: {actionSourceSummary(action)}</li>
    </ol>
  );
}

function TodayMobileDecision({
  nothingToDecide,
  onNavigate,
  action,
  onAccept,
  onPostpone,
  postponeBusy,
  postponeError,
  onOpenExpert,
}: {
  readonly nothingToDecide: boolean;
  readonly onNavigate?: (view: CareerCabinetView, options?: NavigationOptions) => void;
  readonly action?: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onPostpone: () => void | Promise<void>;
  readonly postponeBusy: boolean;
  readonly postponeError?: string;
  readonly onOpenExpert?: () => void;
}) {
  return (
    <section
      className={action && !nothingToDecide ? 'tm-hero is-decision' : 'tm-hero'}
      aria-label="Следующее решение"
      aria-busy={postponeBusy || undefined}
    >
      <p className="tm-eyebrow">Следующее решение</p>
      {nothingToDecide ? (
        <TodayMobileNothingToDecide onNavigate={onNavigate} onOpenExpert={onOpenExpert} />
      ) : (
        <TodayMobileDecisionBody
          action={action}
          onAccept={onAccept}
          onPostpone={onPostpone}
          postponeBusy={postponeBusy}
          postponeError={postponeError}
          onOpenExpert={onOpenExpert}
        />
      )}
    </section>
  );
}

function TodayMobileNothingToDecide({
  onNavigate,
  onOpenExpert,
}: {
  readonly onNavigate?: (view: CareerCabinetView, options?: NavigationOptions) => void;
  readonly onOpenExpert?: () => void;
}) {
  return (
    <>
      <h2>{TODAY_NOTHING_TO_DECIDE}</h2>
      {onNavigate ? (
        <button
          className="pm-cta tm-main"
          type="button"
          onClick={() => onNavigate('opportunities')}
        >
          <Briefcase aria-hidden="true" weight="regular" />
          Открыть вакансии
        </button>
      ) : null}
      {onOpenExpert ? (
        <button className="pm-text tm-later" type="button" onClick={onOpenExpert}>
          Обсудить цель
        </button>
      ) : null}
    </>
  );
}

function TodayMobileDecisionBody({
  action,
  onAccept,
  onPostpone,
  postponeBusy,
  postponeError,
  onOpenExpert,
}: {
  readonly action?: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onPostpone: () => void | Promise<void>;
  readonly postponeBusy: boolean;
  readonly postponeError?: string;
  readonly onOpenExpert?: () => void;
}) {
  return (
    <>
      <h2>{action?.headline ?? 'Нет проверенного следующего шага'}</h2>
      <p className="tm-effect">
        {action?.expectedChange ?? 'В текущих данных нет основания предложить конкретное действие.'}
      </p>
      {action ? (
        <TodayMobileDecisionActions
          action={action}
          onAccept={onAccept}
          onPostpone={onPostpone}
          postponeBusy={postponeBusy}
          postponeError={postponeError}
        />
      ) : onOpenExpert ? (
        <button className="tm-why" type="button" onClick={onOpenExpert}>
          Обсудить <CaretRight aria-hidden="true" weight="regular" />
        </button>
      ) : (
        <p className="pm-foot">Источники: нет проверенных данных</p>
      )}
    </>
  );
}

function TodayMobileDecisionActions({
  action,
  onAccept,
  onPostpone,
  postponeBusy,
  postponeError,
}: {
  readonly action: ReasonedCareerAction;
  readonly onAccept: () => void;
  readonly onPostpone: () => void | Promise<void>;
  readonly postponeBusy: boolean;
  readonly postponeError?: string;
}) {
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const reasonsId = useId();
  return (
    <>
      <button className="pm-cta tm-main" type="button" onClick={onAccept}>
        <CheckCircle aria-hidden="true" weight="regular" />
        {decisionAcceptLabel(action)}
      </button>
      <button
        className="pm-text tm-later"
        type="button"
        disabled={postponeBusy}
        onClick={() => void onPostpone()}
      >
        {postponeBusy ? 'Сохраняем…' : 'Отложить до завтра'}
      </button>
      {postponeError ? (
        <p className="pm-foot" role="alert">
          {postponeError}
        </p>
      ) : null}
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
  );
}

const MOBILE_FUNNEL_LABELS: Partial<Record<TodayFunnelStage['key'], string>> = {
  favorites: 'Избранное',
  applied: 'Отклики',
  responses: 'Ответы',
  interviews: 'Интервью',
};

function TodayMobileFunnel({
  snapshot,
  context,
}: {
  readonly snapshot: TodaySnapshot;
  readonly context?: TodayFunnelContext;
}) {
  const stages = todayFunnelStages(snapshot, context);
  const items = stages.flatMap((stage) => {
    const label = MOBILE_FUNNEL_LABELS[stage.key];
    return label ? [{ label, value: stage.value }] : [];
  });
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
                ? `${item.label}: нет проверенных данных`
                : `${item.label}: ${item.value}`
            }
          >
            <b className="num">{typeof item.value === 'number' ? item.value : '—'}</b>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <p className="pm-foot">{todayFunnelFootnote(snapshot, stages)}</p>
    </section>
  );
}

function TodayMobileProfileRow({
  profileDraft,
  onNavigate,
}: {
  readonly profileDraft?: ResumeDraft;
  readonly onNavigate?: (view: CareerCabinetView, options?: NavigationOptions) => void;
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
      <p className="career-today-error-note" role="alert">
        <WarningCircle size={16} aria-hidden="true" />
        <span>
          Не удалось собрать очередь: сервер не ответил. Решение дня сохранено, очередь повторится.
        </span>
      </p>
      <button
        type="button"
        className="career-quiet-button career-today-error-retry"
        onClick={onRetry}
      >
        <ArrowsClockwise size={16} aria-hidden="true" /> Повторить
      </button>
    </div>
  );
}
