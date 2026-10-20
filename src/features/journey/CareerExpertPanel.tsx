import { AdaptationAdviceContext } from '../diary/AdaptationAdviceContext';
import { AdaptationTaskProposal } from '../diary/AdaptationTaskProposal';
import { ProfileFactsProposal } from '../resume/ProfileFactsProposal';
import { TodayDecisionProposal } from '../today/TodayDecisionProposal';
import { useEffect, useRef, useState } from 'react';
import {
  STAGE_TITLE,
  STAGE_INITIAL_REPLICA,
  useConsultantHistory,
  usePendingConsultantProposals,
  ConsultantStripButton,
  MobileConsultantStagePicker,
} from '../shell/CareerWorkspaceShellHelpers';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  ArrowRight,
  CaretDoubleRight,
  CaretDown,
  CaretUp,
  ClockCounterClockwise,
  PaperPlaneTilt,
  ShieldCheck,
  Sparkle,
  Spinner,
  X,
} from '@phosphor-icons/react';
import {
  CoachApiError,
  getCandidateWithMessages,
  login,
  sendCoachTurn,
  type AuthUser,
  type CandidateSnapshot,
  type CoachResult,
  type CoachTurnStage,
  type CoachTurnSubject,
} from '../coach/coachApi';
import { applySkillQuizResult } from '../coach/careerCommandApi';
import { SkillQuizApplyResultCard } from './SkillQuizApplyResultCard';
import { starterPromptsForStage } from './starterPrompts';
import type { CareerJourney } from './careerJourneyEngine';
import { consultantTurns } from './consultantHistory';
import { ComposerModeSplit, type ComposerInputMode } from './ComposerModeSplit';
import { CareerActionProposalList } from './CareerCommandActions';
import { ConsultantMessage } from './ConsultantMessage';
import { VoiceInput } from '../coach/VoiceInput';
import type { VoiceInputState } from '../coach/voiceInputMachine';
import { HhSkillQuizSimulator } from '../skills/HhSkillQuizSimulator';
import { getSkillQuizById, type QuizEvaluationResult } from '../../services/hhSkillQuizzes';
export {
  STAGE_TITLE,
  STAGE_INITIAL_REPLICA,
  ConsultantStripButton,
} from '../shell/CareerWorkspaceShellHelpers';
interface CareerExpertPanelProps {
  collapsed?: boolean;
  intakeMode?: boolean;
  overlay?: boolean;
  onExpand?: () => void;
  journey?: CareerJourney;
  marketQuery?: string;
  stage?: CoachTurnStage;
  subject?: CoachTurnSubject;
  subjectTitle?: string;
  initialPrompt?: string;
  initialUser: AuthUser | null;
  loadingSession?: boolean;
  initialSnapshot?: CandidateSnapshot;
  onIdentityChange?: (user: AuthUser) => void;
  onCommandPrepared?: () => void;
  onProposalCountChange?: (count: number) => void;
  skillQuizBankRequest?: number;
  mobileExpanded?: boolean;
  onToggleMobileExpanded?: () => void;
  onEscape?: () => void;
  onStageChange?: (stage: CoachTurnStage) => void;
  onClose: () => void;
}
export function CareerExpertPanel({
  collapsed = false,
  intakeMode = false,
  overlay = false,
  onExpand,
  journey: _journey,
  marketQuery,
  stage = 'today',
  subject,
  subjectTitle,
  initialPrompt,
  initialUser,
  loadingSession = false,
  initialSnapshot,
  onIdentityChange = () => undefined,
  onCommandPrepared,
  onProposalCountChange,
  skillQuizBankRequest = 0,
  mobileExpanded = false,
  onToggleMobileExpanded,
  onEscape,
  onClose,
  onStageChange,
}: CareerExpertPanelProps) {
  const {
    historyOpen,
    setHistoryOpen,
    historyItems,
    historyBusy,
    historyError,
    historicalConversation,
    setHistoricalConversation,
    historyRequest,
    loadHistory,
  } = useConsultantHistory(initialUser?.candidateId ?? undefined);
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [snapshot, setSnapshot] = useState<CandidateSnapshot | undefined>(initialSnapshot);
  const [liveResult, setLiveResult] = useState<CoachResult>();
  const [liveTurnIdempotencyKey, setLiveTurnIdempotencyKey] = useState<string>();
  const [loadingSnapshot, setLoadingSnapshot] = useState(Boolean(initialUser));
  const [loginOpen, setLoginOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [content, setContent] = useState(initialPrompt ?? '');
  const [quickRepliesDismissed, setQuickRepliesDismissed] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceInputState>('idle');
  const [voiceDraft, setVoiceDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [decisionProposalCount, setDecisionProposalCount] = useState(0);
  const [pendingQuestion, setPendingQuestion] = useState<string>();
  const [error, setError] = useState<string>();
  const [skillQuizOpen, setSkillQuizOpen] = useState(false);
  const lastSkillQuizBankRequest = useRef(0);
  const [skillQuizApplying, setSkillQuizApplying] = useState(false);
  const [skillQuizApplyError, setSkillQuizApplyError] = useState<string>();
  const [appliedSkillQuiz, setAppliedSkillQuiz] =
    useState<Awaited<ReturnType<typeof applySkillQuizResult>>>();
  const skillQuizApplyInFlight = useRef(false);
  const skillQuizApplyIdempotencyKey = useRef<{ quizId: string; key: string }>();
  async function handleAcceptQuizResult(
    res: QuizEvaluationResult,
    answers: Record<string, number>,
  ): Promise<boolean> {
    if (skillQuizApplyInFlight.current) return false;
    const quiz = getSkillQuizById(res.quizId);
    const skillName = quiz?.title.split(':')[0] ?? res.quizId;
    if (skillQuizApplyIdempotencyKey.current?.quizId !== res.quizId) {
      skillQuizApplyIdempotencyKey.current = { quizId: res.quizId, key: crypto.randomUUID() };
    }
    skillQuizApplyInFlight.current = true;
    setSkillQuizApplying(true);
    setSkillQuizApplyError(undefined);
    try {
      const applied = await applySkillQuizResult({
        quizId: res.quizId,
        skillName,
        answers,
        idempotencyKey: skillQuizApplyIdempotencyKey.current.key,
      });
      skillQuizApplyIdempotencyKey.current = undefined;
      setAppliedSkillQuiz(applied);
      return true;
    } catch (reason) {
      setSkillQuizApplyError(skillQuizApplyMessage(reason));
      return false;
    } finally {
      skillQuizApplyInFlight.current = false;
      setSkillQuizApplying(false);
    }
  }
  const contextKey = JSON.stringify([stage, subject]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const previousContext = useRef(contextKey);
  const draftByContext = useRef(new Map<string, string>());
  const contentRef = useRef(content);
  contentRef.current = content;
  useEffect(() => {
    if (previousContext.current === contextKey) return;
    draftByContext.current.set(previousContext.current, contentRef.current);
    previousContext.current = contextKey;
    setContent(draftByContext.current.get(contextKey) ?? initialPrompt ?? '');
    pendingOperation.current = undefined;
    setLiveResult(undefined);
    setLiveTurnIdempotencyKey(undefined);
    setError(undefined);
    setSending(false);
    setPendingQuestion(undefined);
  }, [contextKey, initialPrompt]);

  const pendingOperation = useRef<{
    user: AuthUser;
    content: string;
    marketQuery?: string;
    idempotencyKey: string;
    messageId: string;
  }>();
  useEffect(() => {
    setContent(initialPrompt ?? '');
    pendingOperation.current = undefined;
  }, [initialPrompt]);

  useEffect(() => {
    if (!skillQuizBankRequest || lastSkillQuizBankRequest.current === skillQuizBankRequest) return;
    lastSkillQuizBankRequest.current = skillQuizBankRequest;
    setSkillQuizApplyError(undefined);
    setSkillQuizOpen(true);
  }, [skillQuizBankRequest]);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const [inputMode, setInputMode] = useState<ComposerInputMode>('text');
  const [voiceStartSignal, setVoiceStartSignal] = useState(0);
  function chooseInputMode(mode: ComposerInputMode) {
    setInputMode(mode);
    if (mode === 'voice') setVoiceStartSignal((signal) => signal + 1);
    else inputRef.current?.focus();
  }
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEscapeLayer(onEscape ?? onClose, !collapsed);
  useEffect(() => {
    if (!overlay || onExpand) return;
    const element = panel.current;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled])',
        ) ?? [],
      ).filter((control) => control.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    element?.addEventListener('keydown', trap);
    return () => element?.removeEventListener('keydown', trap);
  }, [overlay, onExpand]);

  // The docked desktop panel is part of the page on load: it must not steal focus (and draw
  // a focus ring) before the candidate acts. A sheet or an explicit expand still moves focus in.
  const panelMounted = useRef(false);
  useEffect(() => {
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!collapsed && (overlay || panelMounted.current)) closeButton.current?.focus();
    panelMounted.current = true;
    return () => returnFocusTo?.focus();
  }, [onClose, collapsed, overlay]);
  useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);
  useEffect(() => {
    if (!user) {
      setSnapshot(undefined);
      setLoadingSnapshot(false);
      return;
    }
    let active = true;
    setLoadingSnapshot(true);
    setLiveResult(undefined);
    setQuickRepliesDismissed(false);
    void getCandidateWithMessages(stage)
      .then((candidate) => {
        if (active) setSnapshot(candidate);
      })
      .catch((reason) => {
        if (active) setError(messageFrom(reason));
      })
      .finally(() => {
        if (active) setLoadingSnapshot(false);
      });
    return () => {
      active = false;
    };
  }, [user, stage]);
  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(undefined);
    try {
      const authenticated = await login(username, password);
      setUser(authenticated);
      onIdentityChange(authenticated);
      setLoginOpen(false);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSending(false);
    }
  }
  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (voiceState !== 'idle' && voiceState !== 'transcribed') return;
    ++historyRequest.current;
    setHistoryOpen(false);
    await sendContent(content);
  }
  async function sendContent(message: string): Promise<boolean> {
    const operationContext = currentContext.current;
    const clean = message.trim();
    if (!clean || !user) return false;
    // На телефоне шторка свёрнута и прячет ленту: отправка раскрывает её, чтобы ответ был виден.
    if (!mobileExpanded) onToggleMobileExpanded?.();
    setQuickRepliesDismissed(true);
    setSending(true);
    setPendingQuestion(clean);
    setError(undefined);
    let delivered = false;
    try {
      const query = marketQuery?.trim() || undefined;
      if (
        !pendingOperation.current ||
        pendingOperation.current.user !== user ||
        pendingOperation.current.content !== clean ||
        pendingOperation.current.marketQuery !== query
      ) {
        pendingOperation.current = {
          user,
          content: clean,
          marketQuery: query,
          idempotencyKey: crypto.randomUUID(),
          messageId: crypto.randomUUID(),
        };
      }
      const { idempotencyKey, messageId } = pendingOperation.current;
      const result = await sendCoachTurn({
        content: clean,
        marketQuery: query,
        stage,
        subject,
        idempotencyKey,
        messageId,
      });
      if (currentContext.current !== operationContext) return false;
      pendingOperation.current = undefined;
      setLiveResult(result);
      setQuickRepliesDismissed(false);
      setLiveTurnIdempotencyKey(idempotencyKey);
      setContent('');
      setVoiceDraft(false);
      delivered = true;
    } catch (reason) {
      if (currentContext.current === operationContext) setError(messageFrom(reason));
    } finally {
      if (currentContext.current === operationContext) {
        setSending(false);
        setPendingQuestion(undefined);
      }
    }
    if (!delivered) return false;
    try {
      const updated = await getCandidateWithMessages(stage);
      if (currentContext.current === operationContext) setSnapshot(updated);
    } catch {
      if (currentContext.current === operationContext) setError('Ответ сохранён, но историю пока не удалось обновить.');
    }
    return true;
  }
  const turns = consultantTurns(snapshot?.messages);
  const latestContextTurn = [...(snapshot?.turns ?? [])].reverse().find(turn => turn.status === 'completed' && turn.result?.adaptationContext);
  const contextResult = liveResult?.adaptationContext ? liveResult : latestContextTurn?.result;
  const contextTurnKey = liveResult?.adaptationContext ? liveTurnIdempotencyKey : latestContextTurn?.idempotencyKey;
  const latestAdaptationTurn = [...(snapshot?.turns ?? [])].reverse().find(turn => turn.status === 'completed' && turn.result?.adaptationTask && turn.result.adaptationContext);
  const adaptationResult = liveResult?.adaptationTask ? liveResult : latestAdaptationTurn?.result;
  const adaptationTurnKey = liveResult?.adaptationTask ? liveTurnIdempotencyKey : latestAdaptationTurn?.idempotencyKey;
  const showLiveMessage =
    liveResult &&
    !snapshot?.messages.some(
      (message) => message.role === 'assistant' && message.content === liveResult.message,
    );
  // After a reply lands, the newest turn is what the candidate came for.
  useEffect(() => {
    historyEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns.length, showLiveMessage]);
  const latestStoredTurn = [...(snapshot?.turns ?? [])]
    .reverse()
    .find((turn) => turn.status === 'completed' && turn.result);
  const latestResult = liveResult ?? latestStoredTurn?.result ?? undefined;
  const lastAssistantMessage = [...turns].reverse().find((message) => message.role === 'assistant');
  const visibleQuickReplies =
    !quickRepliesDismissed &&
    !content.trim() &&
    !sending &&
    !loadingSnapshot &&
    !historyOpen &&
    !historicalConversation
      ? (latestResult?.quickReplies ?? [])
      : [];
  const latestTurnIdempotencyKey = liveResult
    ? liveTurnIdempotencyKey
    : latestStoredTurn?.idempotencyKey;
  const { count: commandProposalCount, refreshProposalCount } = usePendingConsultantProposals(
    latestResult,
    latestTurnIdempotencyKey,
    undefined,
    loadingSnapshot,
  );
  const proposalCount = commandProposalCount + decisionProposalCount;
  useEffect(() => onProposalCountChange?.(proposalCount), [proposalCount, onProposalCountChange]);
  const toggleHistory = () => {
    if (historyOpen) {
      ++historyRequest.current;
      setHistoryOpen(false);
    } else void loadHistory();
  };
  const voiceActive = voiceState !== 'idle';
  const voiceTextLocked = voiceActive && voiceState !== 'transcribed';
  return (
    <section
      id="career-consultant-sheet"
      ref={panel}
      className={`career-expert-panel${intakeMode ? ' is-intake' : ''}${turns.length ? ' has-dialogue' : ''}${mobileExpanded ? ' is-mobile-expanded' : ''}${collapsed ? ' consultant-strip' : ''}${overlay ? ' consultant-overlay' : ''}`}
      role={overlay && !onExpand ? 'dialog' : 'complementary'}
      aria-modal={overlay && !onExpand ? true : undefined}
      data-mobile-expanded={mobileExpanded}
      aria-label={`Консультант · ${intakeMode ? 'Старт' : STAGE_TITLE[stage]}${subjectTitle ? ` · ${subjectTitle}` : ''}`}
    >
      {collapsed ? (
        <ConsultantStripButton
          count={loadingSnapshot ? 0 : proposalCount}
          stageTitle={intakeMode ? 'Старт' : STAGE_TITLE[stage]}
          onExpand={onExpand}
        />
      ) : null}
      <header>
        <div className="career-expert-identity">
          <span>
            <Sparkle size={18} weight="regular" />
          </span>
          <div>
            <strong>Консультант</strong>
            <small>{intakeMode ? 'Старт' : STAGE_TITLE[stage]}</small>
          </div>
        </div>
        <div className="career-expert-panel-controls">
          <MobileConsultantStagePicker stage={stage} onStageChange={onStageChange} />
          <button
            className="career-expert-history-button"
            type="button"
            aria-label="История бесед"
            aria-pressed={historyOpen}
            disabled={loadingSession || !user}
            onClick={toggleHistory}
          >
            <ClockCounterClockwise size="1em" aria-hidden="true" />
          </button>
          <button
            className="career-expert-stage-button consultant-desktop-sheet-toggle"
            type="button"
            aria-label="Развернуть или свернуть консультанта"
            aria-expanded={!collapsed}
            onClick={onExpand ? onClose : onToggleMobileExpanded}
          >
            <CaretDown size="1em" aria-hidden="true" />
          </button>
          <button
            ref={overlay ? undefined : closeButton}
            className="career-close-button"
            type="button"
            onClick={onClose}
            aria-label={
              onExpand ? 'Свернуть консультанта в полосу' : 'Закрыть карьерного консультанта'
            }
            aria-expanded={!collapsed}
          >
            <CaretDoubleRight
              className="career-expert-close-desktop-icon"
              size="1em"
              aria-hidden="true"
            />
            <X className="career-expert-close-mobile-icon" size="1em" aria-hidden="true" />
          </button>
        </div>
        {onToggleMobileExpanded ? (
          <button
            ref={overlay ? closeButton : undefined}
            className="career-expert-sheet-toggle"
            type="button"
            onClick={() => (mobileExpanded ? onClose() : onToggleMobileExpanded())}
            aria-expanded={mobileExpanded}
            aria-label="Развернуть или свернуть консультанта"
          >
            {mobileExpanded ? (
              <CaretDown size={20} aria-hidden="true" />
            ) : (
              <CaretUp size={20} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </header>
      <div
        className={`career-expert-conversation${historyOpen ? ' consultant-history-is-open' : ''}`}
      >
        {historyOpen ? (
          <section
            className="consultant-history"
            aria-label="История бесед"
            aria-busy={historyBusy}
          >
            {historyBusy ? (
              <p role="status">Загружаем беседы…</p>
            ) : historyError ? (
              <>
                <p role="alert">{historyError}</p>
                <button type="button" onClick={() => void loadHistory()}>
                  Повторить
                </button>
              </>
            ) : historyItems.length ? (
              historyItems.map((item) => (
                <button
                  className="consultant-history-row"
                  type="button"
                  key={item.id}
                  aria-label={`Открыть беседу: ${item.summary ?? item.firstPhrase}`}
                  onClick={() => void loadHistory(item.id)}
                >
                  <small>
                    <time dateTime={item.lastMessageAt}>
                      {formatHistoryMoment(item.lastMessageAt)}
                    </time>
                    <b>{STAGE_TITLE[item.stage]}</b>
                  </small>
                  <span>{item.summary ?? item.firstPhrase}</span>
                </button>
              ))
            ) : (
              <p>Бесед пока нет.</p>
            )}
          </section>
        ) : null}
        {historicalConversation && !historyOpen ? (
          <section className="consultant-history-detail" aria-label="Открытая беседа">
            <button
              type="button"
              onClick={() => {
                setHistoricalConversation(undefined);
                void loadHistory();
              }}
            >
              К истории
            </button>
            <button type="button" onClick={() => setHistoricalConversation(undefined)}>
              Назад в диалог
            </button>
            {historicalConversation.messages.map((message) => (
              <article key={message.id}>
                <span>{message.role === 'user' ? 'Вы' : 'Консультант'}</span>
                <ConsultantMessage text={message.content} />
              </article>
            ))}
          </section>
        ) : null}
        <div
          className={historicalConversation ? 'consultant-current-hidden' : 'consultant-current'}
        >
          {loadingSession ? <ExpertPanelSkeleton /> : null}
          {!loadingSession && (turns.length || showLiveMessage) ? (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Фокус нужен для прокрутки истории с клавиатуры, включая Safari.
            <div className="career-dialogue-history" role="log" tabIndex={0} aria-label="История диалога">
              {turns.map((message) => (
                <article className={`career-dialogue-turn is-${message.role}`} key={message.id}>
                  <span>{message.role === 'user' ? 'Вы' : 'Карьерный консультант'}</span>
                  {message.role === 'assistant' ? (
                    <ConsultantMessage text={message.content} />
                  ) : (
                    message.content
                      .split('\n')
                      .map((paragraph, index) =>
                        paragraph ? <p key={`${message.id}-${index}`}>{paragraph}</p> : null,
                      )
                  )}
                  {message.role === 'assistant' &&
                  message.id === lastAssistantMessage?.id &&
                  latestResult?.message === message.content &&
                  visibleQuickReplies.length ? (
                    <ExpertStarterChips
                      prompts={visibleQuickReplies}
                      ariaLabel="Варианты ответа"
                      variantClass="career-expert-quick-replies"
                      onChoose={(reply) => void sendContent(reply)}
                    />
                  ) : null}
                </article>
              ))}
              {showLiveMessage ? (
                <article className="career-dialogue-turn is-assistant" aria-live="polite">
                  <span>Карьерный консультант</span>
                  <ConsultantMessage text={liveResult.message} />
                  {visibleQuickReplies.length ? (
                    <ExpertStarterChips
                      prompts={visibleQuickReplies}
                      ariaLabel="Варианты ответа"
                      variantClass="career-expert-quick-replies"
                      onChoose={(reply) => void sendContent(reply)}
                    />
                  ) : null}
                </article>
              ) : null}
          {stage === 'diary' && contextResult?.adaptationContext && !contextResult.adaptationTask && contextTurnKey ? <AdaptationAdviceContext key={contextTurnKey} turnKey={contextTurnKey} /> : null}
          {stage === 'diary' && adaptationResult?.adaptationTask && adaptationResult.adaptationContext && adaptationTurnKey ? (
            <AdaptationTaskProposal key={adaptationTurnKey} turnKey={adaptationTurnKey}
              context={adaptationResult.adaptationContext} suggestion={adaptationResult.adaptationTask}
              currentSubject={subject} />
          ) : null}

              <div ref={historyEndRef} aria-hidden="true" />
            </div>
          ) : !loadingSession ? (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Фокус нужен для прокрутки истории с клавиатуры, включая Safari.
            <div className="career-dialogue-history" role="log" tabIndex={0} aria-label="История диалога">
              <article className="career-dialogue-turn is-assistant">
                <span>Карьерный консультант</span>
                <ConsultantMessage
                  text={
                    intakeMode
                      ? 'Начнём с источника. Подключите LinkedIn или hh.ru, загрузите резюме или просто расскажите, чем занимаетесь.'
                      : STAGE_INITIAL_REPLICA[stage]
                  }
                />
              </article>
              {user &&
              stage !== 'profile' &&
              !loadingSnapshot &&
              !historyOpen &&
              !content.trim() &&
              !sending ? (
                <ExpertStarterChips
                  prompts={
                    intakeMode
                      ? ['С чего начать?', 'Что вы читаете в LinkedIn?', 'Можно без LinkedIn?']
                      : starterPromptsForStage(stage)
                  }
                  variantClass={intakeMode ? 'career-expert-starters' : undefined}
                  ariaLabel="Темы для начала"
                  onChoose={(prompt) => {
                    setContent(prompt);
                    inputRef.current?.focus();
                  }}
                />
              ) : null}
            </div>
          ) : null}
          {subjectTitle && stage === 'diary' ? <p className="career-diary-note">Контекст: {subjectTitle}</p> : null}
          {pendingQuestion ? <ExpertWaitingRow question={pendingQuestion} /> : null}
          {stage === 'profile' && user && !loadingSnapshot ? (
            <ProfileFactsProposal onStart={(prompt) => void sendContent(prompt)} />
          ) : null}
          {stage === 'today' && turns.length > 0 && !loadingSnapshot ? (
            <TodayDecisionProposal onAvailabilityChange={setDecisionProposalCount} />
          ) : null}
          {latestResult ? (
            <CareerIntelligenceSummary
              result={latestResult}
              turnIdempotencyKey={latestTurnIdempotencyKey}
              onCommandPrepared={() => {
                refreshProposalCount();
                onCommandPrepared?.();
              }}
            />
          ) : null}
          {appliedSkillQuiz ? <SkillQuizApplyResultCard {...appliedSkillQuiz} /> : null}
          {loadingSnapshot ? (
            <div className="career-expert-loading">Загружаем историю и карьерный трек…</div>
          ) : null}
          {!loadingSession && user === null && !loginOpen ? (
            <div className="career-expert-auth">
              <ShieldCheck size={24} />
              <div>
                <strong>Персональный ответ требует входа</strong>
                <p>Так память кандидатов не смешивается, а ключи моделей не попадают в браузер.</p>
              </div>
              <button type="button" onClick={() => setLoginOpen(true)}>
                Войти в аккаунт
                <ArrowRight size={16} />
              </button>
            </div>
          ) : null}
          {!loadingSession && user === null && loginOpen ? (
            <form className="career-expert-login" onSubmit={handleLogin}>
              <label>
                <span>Логин</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                <span>Пароль</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button className="career-primary-button" disabled={sending}>
                {sending ? 'Проверяем…' : 'Продолжить'}
              </button>
            </form>
          ) : null}
        </div>
      </div>
      {loadingSession ? <ExpertComposerSkeleton /> : null}
      {user && !loadingSession && !historicalConversation ? (
        <form className="career-expert-composer" onSubmit={handleSend}>
          <label className="career-sr-only" htmlFor="career-expert-input">
            Сообщение карьерному консультанту
          </label>
          <div
            className={`career-expert-input-row${voiceActive ? ' is-voice-active' : ''}${content.trim() ? ' has-text' : ''}`}
          >
            <textarea
              ref={inputRef}
              id="career-expert-input"
              maxLength={subject?.kind === 'adaptation' ? 7000 : 8000}
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                if (event.target.value.trim()) setQuickRepliesDismissed(true);
                if (!event.target.value.trim()) setVoiceDraft(false);
              }}
              placeholder="Спросите по этому разделу"
              rows={1}
              disabled={sending || voiceTextLocked}
            />
            {!voiceActive ? (
              <ComposerModeSplit
                mode={inputMode}
                canSend={Boolean(content.trim())}
                sending={sending}
                sendLabel={voiceDraft ? 'Отправить голосом' : 'Отправить вопрос'}
                onChooseMode={chooseInputMode}
              />
            ) : null}
            <VoiceInput
              hideTrigger
              startSignal={voiceStartSignal}
              value={content}
              disabled={sending}
              onChange={(value) => {
                setContent(value);
                if (value.trim()) setQuickRepliesDismissed(true);
              }}
              onStateChange={(nextState) => {
                setVoiceState(nextState);
                if (nextState !== 'idle' && !mobileExpanded) onToggleMobileExpanded?.();
              }}
              onVoiceDraftChange={setVoiceDraft}
              onSubmitVoice={sendContent}
              onTextMode={() => inputRef.current?.focus()}
            />
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="career-expert-error" role="alert">
          {error}
        </p>
      ) : null}
      {skillQuizOpen ? (
        <HhSkillQuizSimulator
          onClose={() => {
            setSkillQuizOpen(false);
            setSkillQuizApplyError(undefined);
            if (!skillQuizApplyInFlight.current) skillQuizApplyIdempotencyKey.current = undefined;
          }}
          onAcceptResult={handleAcceptQuizResult}
          isApplying={skillQuizApplying}
          acceptError={skillQuizApplyError}
        />
      ) : null}
    </section>
  );
}
function ExpertPanelSkeleton() {
  return (
    <div className="career-expert-panel-skeleton" aria-hidden="true">
      <span className="career-expert-skeleton-line is-wide" />
      <span className="career-expert-skeleton-line" />
      <span className="career-expert-skeleton-line is-wide" />
    </div>
  );
}
function ExpertComposerSkeleton() {
  return (
    <div className="career-expert-composer-skeleton" aria-hidden="true">
      <span>Спросите по этому разделу</span>
      <span>
        <PaperPlaneTilt size={18} />
      </span>
    </div>
  );
}
export function ExpertStarterChips({
  prompts,
  ariaLabel,
  onChoose,
  variantClass,
}: {
  readonly prompts: readonly string[];
  readonly ariaLabel: string;
  readonly onChoose: (prompt: string) => void;
  readonly variantClass?: string;
}) {
  return (
    <div
      className={`career-expert-chip-group${variantClass ? ` ${variantClass}` : ''}`}
      role="group"
      aria-label={ariaLabel}
    >
      {prompts.map((prompt) => (
        <button
          className="career-expert-starter-chip"
          type="button"
          key={prompt}
          onClick={() => onChoose(prompt)}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
/** Показываем ожидание, пока ответ консультанта не доставлен. */
export function ExpertWaitingRow({ question }: { question: string }) {
  return (
    <article className="career-dialogue-turn is-user" aria-live="polite" aria-busy="true">
      <span>Вы</span>
      <p>{question}</p>
      <p>
        <Spinner size={16} /> Консультант читает ваши факты и рынок — ответ занимает до полутора
        минут. Не закрывайте панель.
      </p>
    </article>
  );
}
export function CareerIntelligenceSummary({
  result,
  turnIdempotencyKey,
  onCommandPrepared,
}: {
  result: CoachResult;
  turnIdempotencyKey?: string;
  onCommandPrepared?: () => void;
}) {
  return (
    <section className="career-intelligence-summary" aria-label="Карьерный трек и действия">
      {result.careerTrack ? (
        <div className="career-track-card">
          <span>Измеримый карьерный трек</span>
          <strong>{result.careerTrack.objective}</strong>
          <ol>
            {result.careerTrack.milestones.map((milestone) => (
              <li key={`${milestone.label}-${milestone.measureAfter}`}>
                <b>{milestone.label}</b>
                <p>{milestone.successCriterion}</p>
                <small>
                  Проверка {formatDate(milestone.measureAfter)} · {milestone.expectedSignal}
                </small>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {result.actionProposals.length ? (
        <CareerActionProposalList
          proposals={result.actionProposals}
          turnIdempotencyKey={turnIdempotencyKey}
          onCommandPrepared={onCommandPrepared}
        />
      ) : null}
    </section>
  );
}

function formatHistoryMoment(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}
function messageFrom(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return 'Не удалось открыть защищённый диалог. Попробуйте ещё раз.';
}
function skillQuizApplyMessage(reason: unknown): string {
  if (reason instanceof CoachApiError && reason.code !== 'network_error') return reason.message;
  return 'Не удалось сохранить результат. Проверьте соединение и попробуйте ещё раз.';
}
