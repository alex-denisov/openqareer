import { useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  ArrowRight,
  CaretDown,
  CaretUp,
  Microphone,
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
import type { CareerJourney } from './careerJourneyEngine';
import { consultantTurns } from './consultantHistory';
import { CareerActionProposalList } from './CareerCommandActions';
import { ConsultantMessage } from './ConsultantMessage';
import { HhSkillQuizSimulator } from '../skills/HhSkillQuizSimulator';
import {
  getSkillQuizById,
  type QuizEvaluationResult,
} from '../../services/hhSkillQuizzes';

export const STAGE_TITLE: Record<CoachTurnStage, string> = {
  profile: 'Профиль',
  career: 'Карьера',
  vacancies: 'Вакансии',
  responses: 'Отклики',
  interviews: 'Интервью',
  today: 'Сегодня',
};

export const STAGE_INITIAL_REPLICA: Record<CoachTurnStage, string> = {
  profile: 'Покажу, что срежет рекрутер за 30 секунд, и предложу правки по фактам вашего профиля.',
  career: 'Разберём, какие роли вам реально подходят и как их называют в разных компаниях.',
  vacancies: 'Выберите вакансию — сравню её требования с вашим опытом и скажу, где пробелы.',
  responses: 'Подскажу, кому и когда напомнить о себе и что написать.',
  interviews: 'Соберу вопросы, которые вам вероятно зададут, и ответы из вашего опыта.',
  today: 'Скажу, какой шаг сегодня даст больше всего.',
};

interface CareerExpertPanelProps {
  journey?: CareerJourney;
  marketQuery?: string;
  stage?: CoachTurnStage;
  subject?: CoachTurnSubject;
  subjectTitle?: string;
  initialUser: AuthUser | null;
  loadingSession?: boolean;
  initialSnapshot?: CandidateSnapshot;
  onIdentityChange?: (user: AuthUser) => void;
  onCommandPrepared?: () => void;
  mobileExpanded?: boolean;
  onToggleMobileExpanded?: () => void;
  onEscape?: () => void;
  onClose: () => void;
}

export function CareerExpertPanel({
  journey,
  marketQuery,
  stage = 'today',
  subject,
  subjectTitle,
  initialUser,
  loadingSession = false,
  initialSnapshot,
  onIdentityChange = () => undefined,
  onCommandPrepared,
  mobileExpanded = false,
  onToggleMobileExpanded,
  onEscape,
  onClose,
}: CareerExpertPanelProps) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [snapshot, setSnapshot] = useState<CandidateSnapshot | undefined>(initialSnapshot);
  const [liveResult, setLiveResult] = useState<CoachResult>();
  const [liveTurnIdempotencyKey, setLiveTurnIdempotencyKey] = useState<string>();
  const [loadingSnapshot, setLoadingSnapshot] = useState(Boolean(initialUser));
  const [loginOpen, setLoginOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string>();
  const [error, setError] = useState<string>();
  const [skillQuizOpen, setSkillQuizOpen] = useState(false);
  const [skillQuizApplying, setSkillQuizApplying] = useState(false);
  const [skillQuizApplyError, setSkillQuizApplyError] = useState<string>();
  const [appliedSkillQuiz, setAppliedSkillQuiz] = useState<Awaited<ReturnType<typeof applySkillQuizResult>>>();
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
  const pendingOperation = useRef<{
    user: AuthUser;
    content: string;
    marketQuery?: string;
    idempotencyKey: string;
    messageId: string;
  }>();
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEscapeLayer(onEscape ?? onClose);

  useEffect(() => {
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => {
      returnFocusTo?.focus();
    };
  }, [onClose]);

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
    const clean = content.trim();
    if (!clean || !user) return;
    // На телефоне шторка свёрнута и прячет ленту: отправка раскрывает её, чтобы ответ был виден.
    if (!mobileExpanded) onToggleMobileExpanded?.();
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
      pendingOperation.current = undefined;
      setLiveResult(result);
      setLiveTurnIdempotencyKey(idempotencyKey);
      setContent('');
      delivered = true;
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSending(false);
      setPendingQuestion(undefined);
    }
    // Ответ уже доставлен и показан, поэтому следующий вопрос доступен сразу.
    // Обновление истории — отдельная сетевая операция: на проблемном канале она
    // может тянуться или не дойти, и держать на ней композер значит отнимать у
    // кандидата разговор из-за уже полученного ответа (B198).
    if (!delivered) return;
    try {
      setSnapshot(await getCandidateWithMessages(stage));
    } catch {
      setError('Ответ сохранён, но историю пока не удалось обновить.');
    }
  }

  const turns = consultantTurns(snapshot?.messages);
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
  const latestTurnIdempotencyKey = liveResult
    ? liveTurnIdempotencyKey
    : latestStoredTurn?.idempotencyKey;

  return (
    <aside
      ref={panel}
      className={`career-expert-panel${mobileExpanded ? ' is-mobile-expanded' : ''}`}
      data-mobile-expanded={mobileExpanded}
      aria-label={`Консультант · ${STAGE_TITLE[stage]}`}
    >
      <header>
        <div className="career-expert-identity">
          <span>
            <Sparkle size={18} weight="fill" />
          </span>
          <div>
            <strong>Консультант · {STAGE_TITLE[stage]}</strong>
            <small>
              {loadingSession
                ? 'Проверяем вход и читаем ваш профиль'
                : subjectTitle ?? (user ? 'Персональный карьерный консультант' : 'Защищённый диалог')}
            </small>
          </div>
        </div>
        {onToggleMobileExpanded ? (
          <button
            className="career-expert-sheet-toggle"
            type="button"
            onClick={onToggleMobileExpanded}
            aria-expanded={mobileExpanded}
            aria-label={mobileExpanded ? 'Свернуть консультанта' : 'Развернуть консультанта'}
          >
            {mobileExpanded ? <CaretDown size={20} /> : <CaretUp size={20} />}
          </button>
        ) : null}
        <button
          ref={closeButton}
          className="career-close-button"
          type="button"
          onClick={onClose}
          aria-label="Закрыть карьерного консультанта"
        >
          <X size={20} />
        </button>
      </header>

      <div className="career-expert-conversation">
        {loadingSession ? (
          <ExpertPanelSkeleton />
        ) : (
          <div className="career-expert-message">
            <span>AI-сопровождение</span>
            <strong>{journey?.nextAction.headline ?? 'Задайте вопрос о вашей карьере'}</strong>
            <p>
              {journey?.nextAction.reason ??
                'Помогу оценить рыночные возможности, разобрать стратегию или адаптировать резюме.'}
            </p>
          </div>
        )}

        {!loadingSession && (turns.length || showLiveMessage) ? (
          <div className="career-dialogue-history" aria-label="История диалога">
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
              </article>
            ))}
            {showLiveMessage ? (
              <article className="career-dialogue-turn is-assistant" aria-live="polite">
                <span>Карьерный консультант</span>
                <ConsultantMessage text={liveResult.message} />
              </article>
            ) : null}
            <div ref={historyEndRef} aria-hidden="true" />
          </div>
        ) : !loadingSession ? (
          <div className="career-dialogue-history" aria-label="История диалога">
            <article className="career-dialogue-turn is-assistant">
              <span>Карьерный консультант</span>
              <ConsultantMessage text={STAGE_INITIAL_REPLICA[stage]} />
            </article>
          </div>
        ) : null}

        {stage === 'profile' ? (
          <div className="career-expert-skill-quiz-prompt" aria-label="Подтверждение навыков">
            <span>Проверка навыков со стратегом</span>
            <strong>Подтвердите заявленные навыки по банку квизов hh.ru и LinkedIn</strong>
            <p>
              3–5 вопросов квиза зафиксируют статус факта («подтверждён» или «не подтверждено») с источником и датой. Никаких субъективных оценок.
            </p>
            <button
              type="button"
              className="career-quiet-button"
              onClick={() => {
                setSkillQuizApplyError(undefined);
                setSkillQuizOpen(true);
              }}
            >
              <Sparkle size={16} weight="fill" /> Пройти квиз по навыку
            </button>
          </div>
        ) : null}

        {pendingQuestion ? <ExpertWaitingRow question={pendingQuestion} /> : null}

        {latestResult ? (
          <CareerIntelligenceSummary
            result={latestResult}
            turnIdempotencyKey={latestTurnIdempotencyKey}
            onCommandPrepared={onCommandPrepared}
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

      {loadingSession ? <ExpertComposerSkeleton /> : null}
      {user && !loadingSession ? (
        <form className="career-expert-composer" onSubmit={handleSend}>
          {!content.trim() ? (
            <ExpertStarterChips
              onChoose={(prompt) => {
                setContent(prompt);
                inputRef.current?.focus();
              }}
            />
          ) : null}
          <label className="career-sr-only" htmlFor="career-expert-input">
            Сообщение карьерному консультанту
          </label>
          <div className="career-expert-input-row">
            <textarea
              ref={inputRef}
              id="career-expert-input"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Сообщение консультанту"
              rows={1}
            />
            {content.trim() ? (
              <button type="submit" disabled={sending} aria-label="Отправить вопрос">
                {sending ? <Spinner size={18} /> : <PaperPlaneTilt size={18} weight="fill" />}
              </button>
            ) : (
              <button type="button" className="career-expert-microphone" disabled aria-label="Голосовой ввод скоро" title="Голосовой ввод скоро">
                <Microphone size={18} aria-hidden="true" />
              </button>
            )}
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
    </aside>
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
      <span />
      <span />
    </div>
  );
}

const EXPERT_STARTER_PROMPTS = ['С чего начать?', 'Какие источники можно подключить?', 'Можно без подключений?'];

function ExpertStarterChips({ onChoose }: { readonly onChoose: (prompt: string) => void }) {
  return (
    <div className="career-expert-starters" role="group" aria-label="Темы для начала">
      {EXPERT_STARTER_PROMPTS.map((prompt) => (
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

/**
 * The answer takes up to ~95 seconds. Until it arrives the only sign the
 * question left the browser was the send button swapping its icon for a tick —
 * which reads as «done», not «waiting», so the candidate either leaves or asks
 * the same question twice (B162, P1-3).
 */
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

/**
 * A check date without a year cannot be read: «Проверка 31 дек.» leaves the
 * candidate guessing whether the deadline has already passed (B162).
 */
function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}

function messageFrom(reason: unknown): string {
  if (reason instanceof CoachApiError) return reason.message;
  if (reason instanceof Error) return reason.message;
  return 'Не удалось открыть защищённый диалог. Попробуйте ещё раз.';
}

function skillQuizApplyMessage(reason: unknown): string {
  if (reason instanceof CoachApiError && reason.code !== 'network_error') return reason.message;
  return 'Не удалось сохранить результат. Проверьте соединение и попробуйте ещё раз.';
}
