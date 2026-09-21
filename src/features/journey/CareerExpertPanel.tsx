import { useEffect, useRef, useState } from 'react';
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
} from '../coach/coachApi';
import type { CareerJourney } from './careerJourneyEngine';
import { CareerActionProposalList } from './CareerCommandActions';

interface CareerExpertPanelProps {
  journey?: CareerJourney;
  marketQuery?: string;
  initialUser: AuthUser | null;
  initialSnapshot?: CandidateSnapshot;
  onIdentityChange?: (user: AuthUser) => void;
  onClose: () => void;
}

export function CareerExpertPanel({
  journey,
  marketQuery,
  initialUser,
  initialSnapshot,
  onIdentityChange = () => undefined,
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
  const pendingOperation = useRef<{
    user: AuthUser;
    content: string;
    marketQuery?: string;
    idempotencyKey: string;
    messageId: string;
  }>();
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
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
    void getCandidateWithMessages()
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
  }, [user]);

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
      setSnapshot(await getCandidateWithMessages());
    } catch {
      setError('Ответ сохранён, но историю пока не удалось обновить.');
    }
  }

  const showLiveMessage =
    liveResult &&
    !snapshot?.messages.some(
      (message) => message.role === 'assistant' && message.content === liveResult.message,
    );
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
      aria-label="Карьерный эксперт"
    >
      <header>
        <div className="career-expert-identity">
          <span>
            <Sparkle size={18} weight="fill" />
          </span>
          <div>
            <strong>Карьерный консультант</strong>
            <small>{user ? 'Персональный карьерный консультант' : 'Защищённый диалог'}</small>
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

        {snapshot?.messages.length || showLiveMessage ? (
          <div className="career-dialogue-history" aria-label="История диалога">
            {snapshot?.messages.map((message) => (
              <article className={`career-dialogue-turn is-${message.role}`} key={message.id}>
                <span>{message.role === 'user' ? 'Вы' : 'Карьерный консультант'}</span>
                {message.content
                  .split('\n')
                  .map((paragraph, index) =>
                    paragraph ? <p key={`${message.id}-${index}`}>{paragraph}</p> : null,
                  )}
              </article>
            ))}
            {showLiveMessage ? (
              <article className="career-dialogue-turn is-assistant" aria-live="polite">
                <span>Карьерный консультант</span>
                {liveResult.message
                  .split('\n')
                  .map((paragraph, index) => (paragraph ? <p key={index}>{paragraph}</p> : null))}
              </article>
            ) : null}
          </div>
        ) : null}

        {pendingQuestion ? <ExpertWaitingRow question={pendingQuestion} /> : null}

        {latestResult ? (
          <CareerIntelligenceSummary
            result={latestResult}
            turnIdempotencyKey={latestTurnIdempotencyKey}
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
        <Spinner size={16} /> Консультант читает ваши факты и рынок — ответ занимает до полутора минут.
        Не закрывайте панель.
      </p>
    </article>
  );
}

export function CareerIntelligenceSummary({
  result,
  turnIdempotencyKey,
}: {
  result: CoachResult;
  turnIdempotencyKey?: string;
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
