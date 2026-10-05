import { useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  ArrowRight,
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
import type { CareerJourney } from './careerJourneyEngine';
import { consultantTurns } from './consultantHistory';
import { CareerActionProposalList } from './CareerCommandActions';
import { ConsultantMessage } from './ConsultantMessage';
import { HhSkillQuizSimulator } from '../skills/HhSkillQuizSimulator';
import {
  createSkillVerificationProposal,
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
  initialSnapshot?: CandidateSnapshot;
  onIdentityChange?: (user: AuthUser) => void;
  onCommandPrepared?: () => void;
  onClose: () => void;
}

export function CareerExpertPanel({
  journey,
  marketQuery,
  stage = 'today',
  subject,
  subjectTitle,
  initialUser,
  initialSnapshot,
  onIdentityChange = () => undefined,
  onCommandPrepared,
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

  function handleAcceptQuizResult(res: QuizEvaluationResult) {
    const quiz = getSkillQuizById(res.quizId);
    const skillName = quiz?.title.split(':')[0] ?? res.quizId;
    const proposal = createSkillVerificationProposal(skillName, res);
    const turnKey = liveTurnIdempotencyKey ?? crypto.randomUUID();
    setLiveTurnIdempotencyKey(turnKey);
    setLiveResult((prev) => ({
      message:
        prev?.message ??
        `Результат квиза: статус навыка ${skillName} — ${res.statusLabel} (${res.source}, дата: ${res.verifiedAt}). Подготовлено предложение правок для профиля с возможностью отката.`,
      phase: 'discovery',
      nextQuestion: null,
      completeness: prev?.completeness ?? { known: [], unknown: [] },
      safety: { needsHuman: false, reason: null },
      careerTrack: prev?.careerTrack ?? null,
      actionProposals: [
        proposal as unknown as CoachResult['actionProposals'][number],
        ...(prev?.actionProposals ?? []),
      ],
    }));
    setSkillQuizOpen(false);
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
  useEscapeLayer(onClose);

  useEffect(() => {
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
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
      className="career-expert-panel"
      role="dialog"
      aria-modal="true"
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
              {subjectTitle ?? (user ? 'Персональный карьерный консультант' : 'Защищённый диалог')}
            </small>
          </div>
        </div>
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
        <div className="career-expert-message">
          <span>AI-сопровождение</span>
          <strong>{journey?.nextAction.headline ?? 'Задайте вопрос о вашей карьере'}</strong>
          <p>
            {journey?.nextAction.reason ??
              'Помогу оценить рыночные возможности, разобрать стратегию или адаптировать резюме.'}
          </p>
        </div>

        {turns.length || showLiveMessage ? (
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
        ) : (
          <div className="career-dialogue-history" aria-label="История диалога">
            <article className="career-dialogue-turn is-assistant">
              <span>Карьерный консультант</span>
              <ConsultantMessage text={STAGE_INITIAL_REPLICA[stage]} />
            </article>
          </div>
        )}

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
              onClick={() => setSkillQuizOpen(true)}
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

        {loadingSnapshot ? (
          <div className="career-expert-loading">Загружаем историю и карьерный трек…</div>
        ) : null}

        {user === null && !loginOpen ? (
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

        {user === null && loginOpen ? (
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

      {user ? (
        <form className="career-expert-composer" onSubmit={handleSend}>
          <label htmlFor="career-expert-input">Сообщение карьерному консультанту</label>
          <div>
            <textarea
              id="career-expert-input"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Например: как лучше усилить позиционирование для целевой роли?"
              rows={3}
            />
            <button
              type="submit"
              disabled={!content.trim() || sending}
              aria-label="Отправить вопрос"
            >
              {sending ? <Spinner size={18} /> : <PaperPlaneTilt size={18} weight="fill" />}
            </button>
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
          onClose={() => setSkillQuizOpen(false)}
          onAcceptResult={handleAcceptQuizResult}
        />
      ) : null}
    </aside>
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
