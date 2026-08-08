import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  PaperPlaneTilt,
  ShieldCheck,
  Sparkle,
  X,
} from '@phosphor-icons/react';
import {
  CoachApiError,
  getSession,
  login,
  sendCoachTurn,
  type AuthUser,
  type CoachPhase,
} from '../coach/coachApi';
import type { CareerJourney } from './careerJourneyEngine';

interface CareerExpertPanelProps {
  journey?: CareerJourney;
  phase: CoachPhase;
  onClose: () => void;
}

export function CareerExpertPanel({
  journey,
  phase,
  onClose,
}: CareerExpertPanelProps) {
  const [user, setUser] = useState<AuthUser | null>();
  const [loginOpen, setLoginOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [content, setContent] = useState('');
  const [answer, setAnswer] = useState<string>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnFocusTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButton.current?.focus();
    let active = true;
    void getSession()
      .then((session) => {
        if (active) setUser(session);
      })
      .catch(() => {
        if (active) setUser(null);
      });
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
      active = false;
      window.removeEventListener('keydown', onKeyDown);
      returnFocusTo?.focus();
    };
  }, [onClose]);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(undefined);
    try {
      setUser(await login(username, password));
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
    setError(undefined);
    try {
      const result = await sendCoachTurn({ content: clean, phase });
      setAnswer([result.message, result.nextQuestion].filter(Boolean).join('\n\n'));
      setContent('');
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSending(false);
    }
  }

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
          <span><Sparkle size={18} weight="fill" /></span>
          <div>
            <strong>Карьерный эксперт</strong>
            <small>{user ? 'Защищённый AI-диалог' : 'Контекст текущего решения'}</small>
          </div>
        </div>
        <button
          ref={closeButton}
          className="career-close-button"
          type="button"
          onClick={onClose}
          aria-label="Закрыть карьерного эксперта"
        >
          <X size={20} />
        </button>
      </header>

      <div className="career-expert-conversation">
        <div className="career-expert-message">
          <span>Почему это сейчас</span>
          <strong>{journey?.nextAction.headline ?? 'Начнём с вашего вопроса'}</strong>
          <p>
            {journey?.nextAction.reason ??
              'Ответы станут предложенной памятью. Вы сможете подтвердить или исправить каждый вывод.'}
          </p>
        </div>

        {answer ? (
          <div className="career-expert-answer">
            <span><Sparkle size={15} weight="fill" /> Ответ эксперта</span>
            {answer.split('\n').map((paragraph) =>
              paragraph ? <p key={paragraph}>{paragraph}</p> : null,
            )}
          </div>
        ) : null}

        {user === undefined ? (
          <div className="career-expert-loading">Проверяем защищённую сессию…</div>
        ) : null}

        {user === null && !loginOpen ? (
          <div className="career-expert-auth">
            <ShieldCheck size={24} />
            <div>
              <strong>Персональный ответ требует входа</strong>
              <p>
                Так память кандидатов не смешивается, а ключи моделей не
                попадают в браузер.
              </p>
            </div>
            <button type="button" onClick={() => setLoginOpen(true)}>
              Войти в тестовый контур
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
          <label htmlFor="career-expert-input">Вопрос эксперту</label>
          <div>
            <textarea
              id="career-expert-input"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Например: почему эта роль, а не руководитель поддержки?"
              rows={3}
            />
            <button type="submit" disabled={!content.trim() || sending} aria-label="Отправить вопрос">
              {sending ? <Check size={18} /> : <PaperPlaneTilt size={18} weight="fill" />}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="career-expert-error" role="alert">{error}</p> : null}
    </aside>
  );
}

function messageFrom(reason: unknown): string {
  if (reason instanceof CoachApiError) return reason.message;
  if (reason instanceof Error) return reason.message;
  return 'Не удалось открыть защищённый диалог. Попробуйте ещё раз.';
}
