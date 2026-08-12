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
  getCandidate,
  login,
  sendCoachTurn,
  type AuthUser,
  type CandidateSnapshot,
  type CoachResult,
} from '../coach/coachApi';
import type { CareerJourney } from './careerJourneyEngine';

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
  const [snapshot, setSnapshot] = useState<CandidateSnapshot | undefined>(
    initialSnapshot,
  );
  const [liveResult, setLiveResult] = useState<CoachResult>();
  const [loadingSnapshot, setLoadingSnapshot] = useState(Boolean(initialUser));
  const [loginOpen, setLoginOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [content, setContent] = useState('');
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
    void getCandidate()
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
    setError(undefined);
    try {
      const result = await sendCoachTurn({
        content: clean,
        marketQuery: marketQuery?.trim() || undefined,
      });
      setLiveResult(result);
      setContent('');
      try {
        setSnapshot(await getCandidate());
      } catch {
        setError('Ответ сохранён, но историю пока не удалось обновить.');
      }
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSending(false);
    }
  }

  const latestStoredResult = [...(snapshot?.turns ?? [])]
    .reverse()
    .find((turn) => turn.status === 'completed' && turn.result)?.result;
  const latestResult = liveResult ?? latestStoredResult ?? undefined;

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
            <strong>Карьерное ядро</strong>
            <small>{user ? 'Консультант · стратег · эксперт' : 'Защищённый AI-диалог'}</small>
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

        {snapshot?.messages.length ? (
          <div className="career-dialogue-history" aria-label="История диалога">
            {snapshot.messages.map((message) => (
              <article
                className={`career-dialogue-turn is-${message.role}`}
                key={message.id}
              >
                <span>{message.role === 'user' ? 'Вы' : 'Карьерное ядро'}</span>
                {message.content.split('\n').map((paragraph, index) =>
                  paragraph ? <p key={`${message.id}-${index}`}>{paragraph}</p> : null,
                )}
              </article>
            ))}
          </div>
        ) : null}

        {latestResult ? <CareerIntelligenceSummary result={latestResult} /> : null}

        {loadingSnapshot ? (
          <div className="career-expert-loading">Загружаем историю и карьерный трек…</div>
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
          <label htmlFor="career-expert-input">Сообщение карьерному ядру</label>
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

export function CareerIntelligenceSummary({ result }: { result: CoachResult }) {
  return (
    <section className="career-intelligence-summary" aria-label="Карьерный трек и действия">
      {result.intelligence ? (
        <div className="career-role-coverage">
          <span>Проверено ролями</span>
          <div>
            {result.intelligence.roleCoverage.map((role) => (
              <small key={role}>{roleLabel(role)}</small>
            ))}
          </div>
          <p>
            Привязка выводов к сообщениям: {Math.round(result.intelligence.evidenceCoverage * 100)}%
          </p>
          {result.intelligence.marketEvidence ? (
            <p>
              Рыночная база: {observationCountLabel(
                result.intelligence.marketEvidence.observationCount,
              )} hh.ru · {formatObservedAt(
                result.intelligence.marketEvidence.observedAt,
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {result.careerTrack ? (
        <div className="career-track-card">
          <span>Измеримый карьерный трек</span>
          <strong>{result.careerTrack.objective}</strong>
          <ol>
            {result.careerTrack.milestones.map((milestone) => (
              <li key={`${milestone.label}-${milestone.measureAfter}`}>
                <b>{milestone.label}</b>
                <p>{milestone.successCriterion}</p>
                <small>Проверка {formatDate(milestone.measureAfter)} · {milestone.expectedSignal}</small>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {result.actionProposals.length ? (
        <div className="career-action-proposals">
          <span>Следующие задания</span>
          {result.actionProposals.map((proposal, index) => (
            <article key={`${proposal.kind}-${index}`}>
              <div>
                <strong>{actionLabel(proposal.kind)}</strong>
                <small>{proposal.risk === 'external_side_effect' ? 'Требует вашего подтверждения' : 'Предложено · ещё не запущено'}</small>
              </div>
              <p>{proposal.objective}</p>
              <small>Сигнал: {proposal.expectedSignal} · проверка {formatDate(proposal.measureAfter)}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function roleLabel(role: NonNullable<CoachResult['intelligence']>['roleCoverage'][number]) {
  return {
    career_consultant: 'Консультант',
    career_strategist: 'Стратег',
    career_expert: 'Эксперт',
  }[role];
}

function actionLabel(kind: CoachResult['actionProposals'][number]['kind']) {
  return {
    'resume.draft': 'Подготовить резюме',
    'resume.revise': 'Улучшить резюме',
    'vacancies.search': 'Найти вакансии',
    'vacancies.local_query': 'Проверить локальную базу вакансий',
    'company.evaluate': 'Оценить компанию',
    'market.evaluate': 'Оценить рынок',
    'cover_letter.draft': 'Подготовить сопроводительное',
    'application.prepare': 'Подготовить отклик',
    'application.submit': 'Отправить отклик',
    'outreach.prepare': 'Подготовить личный контакт',
    'outreach.send': 'Отправить сообщение',
    'connection.request': 'Запросить контакт',
  }[kind];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(value));
}

function observationCountLabel(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun =
    mod10 === 1 && mod100 !== 11
      ? 'наблюдение'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'наблюдения'
        : 'наблюдений';
  return `${count} ${noun}`;
}

function messageFrom(reason: unknown): string {
  if (reason instanceof CoachApiError) return reason.message;
  if (reason instanceof Error) return reason.message;
  return 'Не удалось открыть защищённый диалог. Попробуйте ещё раз.';
}
