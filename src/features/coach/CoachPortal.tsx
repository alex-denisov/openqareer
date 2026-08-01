import { useEffect, useMemo, useRef, useState } from 'react';
import {
  changeMemory,
  CoachApiError,
  getCandidate,
  getProviderStatus,
  getSession,
  login,
  logout,
  sendCoachTurn,
  type AuthUser,
  type CandidateMemory,
  type CandidateSnapshot,
  type CoachPhase,
} from './coachApi';
import { AssessmentStudio } from './AssessmentStudio';

interface CoachPortalProps {
  onBack: () => void;
}

type PortalState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'ready'; user: AuthUser }
  | { status: 'error'; message: string };

const PHASES: Array<{
  id: CoachPhase;
  short: string;
  title: string;
}> = [
  { id: 'discovery', short: '01', title: 'Контекст' },
  { id: 'evidence', short: '02', title: 'Опыт' },
  { id: 'role', short: '03', title: 'Роль' },
  { id: 'market', short: '04', title: 'Рынок' },
  { id: 'resume', short: '05', title: 'Резюме' },
  { id: 'targeting', short: '06', title: 'Выход на рынок' },
];

const STARTERS = [
  'Хочу понять, на какие роли действительно подхожу.',
  'Помоги разобрать мой опыт и честно объяснить пробелы.',
  'Хочу оценить международный поиск и возможную релокацию.',
];

export function CoachPortal({ onBack }: CoachPortalProps) {
  const [state, setState] = useState<PortalState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void getSession()
      .then((user) => {
        if (active) {
          setState(user ? { status: 'ready', user } : { status: 'anonymous' });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: 'error',
            message: messageFrom(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    try {
      await logout();
    } finally {
      setState({ status: 'anonymous' });
    }
  }

  return (
    <main className="coach-portal" data-testid="coach-portal">
      <header className="coach-topbar">
        <button className="coach-back" onClick={onBack}>
          <span aria-hidden="true">←</span>
          В рабочий маршрут
        </button>
        <div className="coach-topbar__context">
          <span className="coach-signal" aria-hidden="true" />
          <span>Защищённая сессия</span>
        </div>
        {state.status === 'ready' ? (
          <button className="coach-logout" onClick={handleLogout}>
            Выйти
          </button>
        ) : (
          <span />
        )}
      </header>

      {state.status === 'loading' ? (
        <PortalLoading />
      ) : state.status === 'anonymous' ? (
        <LoginPanel
          onAuthenticated={(user) => setState({ status: 'ready', user })}
        />
      ) : state.status === 'error' ? (
        <section className="coach-centered" role="alert">
          <p className="eyebrow">Соединение</p>
          <h1>Сервис не открыл сессию</h1>
          <p>{state.message}</p>
          <button
            className="button button--quiet"
            onClick={() => window.location.reload()}
          >
            Повторить
          </button>
        </section>
      ) : state.user.role === 'admin' ? (
        <AdminPreview user={state.user} />
      ) : (
        <CandidateCoach user={state.user} />
      )}
    </main>
  );
}

function LoginPanel({
  onAuthenticated,
}: {
  onAuthenticated: (user: AuthUser) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      onAuthenticated(await login(username, password));
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="login-shell">
      <div className="login-story">
        <p className="eyebrow">Персональный карьерный контур</p>
        <h1>
          Не очередной совет.
          <span> Разговор, который собирает доказательства.</span>
        </h1>
        <p>
          Коуч последовательно разбирает опыт, проверяет гипотезы ролей и
          сохраняет только то, что можно подтвердить или исправить.
        </p>
        <ul className="login-principles">
          <li>
            <span>01</span>
            Один важный вопрос за ход
          </li>
          <li>
            <span>02</span>
            Факты отдельно от гипотез
          </li>
          <li>
            <span>03</span>
            Никаких обещаний трудоустройства
          </li>
        </ul>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Вход</p>
          <h2>Продолжить свой маршрут</h2>
          <p>Используйте выданную тестовую или личную учётную запись.</p>
        </div>
        <label>
          <span>Логин</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            minLength={3}
            maxLength={80}
            placeholder="candidate.test"
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
            maxLength={256}
            placeholder="••••••••••••"
          />
        </label>
        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button button--primary login-submit"
          disabled={submitting}
        >
          {submitting ? 'Проверяем…' : 'Войти в кабинет'}
          <span aria-hidden="true">→</span>
        </button>
        <p className="login-footnote">
          Сессия хранится в защищённой HttpOnly cookie. Ключи моделей никогда
          не попадают в браузер.
        </p>
      </form>
    </section>
  );
}

function CandidateCoach({ user }: { user: AuthUser }) {
  const [surface, setSurface] = useState<'coach' | 'assessment'>('coach');
  const [snapshot, setSnapshot] = useState<CandidateSnapshot>();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string>();
  const [retryTurn, setRetryTurn] = useState<{
    content: string;
    phase: CoachPhase;
    idempotencyKey: string;
    messageId: string;
  }>();
  const messagesEnd = useRef<HTMLDivElement>(null);

  const latestTurn = useMemo(
    () =>
      snapshot?.turns
        .slice()
        .reverse()
        .find((turn) => turn.status === 'completed'),
    [snapshot],
  );
  const phase = latestTurn?.result?.phase ?? 'discovery';
  const phaseIndex = PHASES.findIndex(
    (item) => item.id === (surface === 'assessment' ? 'role' : phase),
  );

  async function refresh() {
    const candidate = await getCandidate();
    setSnapshot(candidate);
    requestAnimationFrame(() =>
      messagesEnd.current?.scrollIntoView({ block: 'end' }),
    );
  }

  useEffect(() => {
    let active = true;
    void getCandidate()
      .then((candidate) => {
        if (active) {
          setSnapshot(candidate);
        }
      })
      .catch((reason) => {
        if (active) {
          setError(messageFrom(reason));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSend(
    text = content,
    existingTurn?: {
      content: string;
      phase: CoachPhase;
      idempotencyKey: string;
      messageId: string;
    },
  ) {
    const trimmed = (existingTurn?.content ?? text).trim();
    if (!trimmed || sending) {
      return;
    }
    setSending(true);
    setError(undefined);
    setRetryTurn(undefined);
    setContent('');
    const turn = existingTurn ?? {
      content: trimmed,
      phase,
      idempotencyKey: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
    };
    try {
      await sendCoachTurn(turn);
      await refresh();
    } catch (reason) {
      setError(messageFrom(reason));
      setRetryTurn(turn);
      try {
        await refresh();
      } catch {
        // The original, more actionable error remains visible.
      }
    } finally {
      setSending(false);
    }
  }

  async function handleMemoryChange(
    memory: CandidateMemory,
    action: 'confirm' | 'delete' | 'correct',
    statement?: string,
  ) {
    setError(undefined);
    try {
      await changeMemory(
        memory.id,
        action === 'correct'
          ? { action, statement: statement ?? memory.statement }
          : { action },
      );
      await refresh();
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }

  if (loading) {
    return <PortalLoading />;
  }

  if (!snapshot) {
    return (
      <section className="coach-centered" role="alert">
        <h1>Профиль не загрузился</h1>
        <p>{error ?? 'Повторите попытку позже.'}</p>
      </section>
    );
  }

  return (
    <div className="coach-workspace">
      <aside className="coach-journey" aria-label="Этапы карьерного маршрута">
        <div className="coach-user">
          <span>{user.username.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.username}</strong>
            <small>{user.isTest ? 'Тестовый кандидат' : 'Кандидат'}</small>
          </div>
        </div>
        <div className="journey-title">
          <p className="eyebrow">Маршрут</p>
          <h2>От опыта к рынку</h2>
        </div>
        <ol className="journey-steps">
          {PHASES.map((item, index) => (
            <li
              key={item.id}
              className={
                index === phaseIndex
                  ? 'is-current'
                  : index < phaseIndex
                    ? 'is-complete'
                    : ''
              }
            >
              {item.id === 'role' || item.id === 'discovery' ? (
                <button
                  className="journey-hit-area"
                  aria-label={
                    item.id === 'role'
                      ? 'Открыть проверку роли'
                      : 'Вернуться к разговору с коучем'
                  }
                  aria-current={index === phaseIndex ? 'step' : undefined}
                  onClick={() =>
                    setSurface(item.id === 'role' ? 'assessment' : 'coach')
                  }
                />
              ) : null}
              <span>{index < phaseIndex ? '✓' : item.short}</span>
              <div>
                <strong>{item.title}</strong>
                <small>
                  {index === phaseIndex
                    ? 'Сейчас'
                    : index < phaseIndex
                      ? 'Собрано'
                      : 'Впереди'}
                </small>
              </div>
            </li>
          ))}
        </ol>
        <div className="journey-privacy">
          <span aria-hidden="true">⌁</span>
          <p>
            Память зашифрована. Любой элемент можно подтвердить, исправить или
            удалить.
          </p>
        </div>
      </aside>

      {surface === 'assessment' ? (
        <AssessmentStudio
          assessments={snapshot.assessments}
          onSaved={refresh}
          onBackToCoach={() => setSurface('coach')}
        />
      ) : (
      <section className="coach-dialogue" aria-label="Диалог с карьерным коучем">
        <header className="dialogue-header">
          <div>
            <p className="eyebrow">ИИ-карьерный партнёр</p>
            <h1>Разбираем вашу реальную историю</h1>
          </div>
          <span className="dialogue-status">
            <i aria-hidden="true" />
            Модель готова
          </span>
        </header>

        {snapshot.candidate.dataClass === 'synthetic' ? (
          <div className="test-data-banner" role="note">
            <strong>Тестовый профиль</strong>
            <span>
              Используйте только вымышленные данные — этот маршрут работает
              через бесплатный тестовый провайдер.
            </span>
          </div>
        ) : null}

        <div className="message-stream" aria-live="polite">
          {snapshot.messages.length === 0 ? (
            <div className="conversation-opening">
              <div className="coach-mark" aria-hidden="true">
                ◌
              </div>
              <p className="eyebrow">Начало разговора</p>
              <h2>С чего начнём?</h2>
              <p>
                Я не буду оценивать вас одной цифрой. Сначала пойму контекст,
                затем помогу проверить роли и собрать доказательства для
                резюме.
              </p>
              <div className="starter-grid">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    onClick={() => void handleSend(starter)}
                    disabled={sending}
                  >
                    {starter}
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            snapshot.messages.map((message) => (
              <article
                key={message.id}
                id={`message-${message.id}`}
                className={`coach-message coach-message--${message.role}`}
              >
                <div className="message-author">
                  <span aria-hidden="true">
                    {message.role === 'assistant' ? '◌' : 'Вы'}
                  </span>
                  <strong>
                    {message.role === 'assistant'
                      ? 'Карьерный партнёр'
                      : 'Ваш ответ'}
                  </strong>
                </div>
                <p>{message.content}</p>
              </article>
            ))
          )}
          {sending ? (
            <div className="coach-thinking" role="status">
              <span />
              <span />
              <span />
              <p>Сопоставляю ответ с уже известными фактами…</p>
            </div>
          ) : null}
          <div ref={messagesEnd} />
        </div>

        <div className="composer-wrap">
          {error ? (
            <div className="coach-error" role="alert">
              <span>{error}</span>
              {retryTurn ? (
                <button
                  type="button"
                  onClick={() => void handleSend('', retryTurn)}
                  disabled={sending}
                >
                  Повторить сохранённый ход
                </button>
              ) : null}
            </div>
          ) : null}
          <form
            className="coach-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSend();
            }}
          >
            <label htmlFor="coach-answer">Ваш ответ</label>
            <textarea
              id="coach-answer"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={
                latestTurn?.result?.nextQuestion ??
                'Расскажите о задаче, результате или выборе, который сейчас важен…'
              }
              maxLength={8_000}
              rows={3}
              disabled={sending}
            />
            <div className="composer-actions">
              <span>{content.length.toLocaleString('ru-RU')} / 8 000</span>
              <button
                className="button button--primary"
                disabled={sending || !content.trim()}
              >
                Отправить
                <span aria-hidden="true">↑</span>
              </button>
            </div>
          </form>
          <p className="coach-disclaimer">
            Коуч может ошибаться. В резюме попадут только подтверждённые вами
            факты; трудоустройство и виза не гарантируются.
          </p>
        </div>
      </section>
      )}

      <MemoryPanel
        snapshot={snapshot}
        onChange={handleMemoryChange}
        onOpenAssessment={() => setSurface('assessment')}
      />
    </div>
  );
}

function MemoryPanel({
  snapshot,
  onChange,
  onOpenAssessment,
}: {
  snapshot: CandidateSnapshot;
  onChange: (
    memory: CandidateMemory,
    action: 'confirm' | 'delete' | 'correct',
    statement?: string,
  ) => Promise<void>;
  onOpenAssessment: () => void;
}) {
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState('');
  const latest = snapshot.turns
    .slice()
    .reverse()
    .find((turn) => turn.result)?.result;
  const memoryById = new Map(
    snapshot.memory.map((memory) => [memory.id, memory]),
  );
  const userMessages = snapshot.messages.filter(
    (message) => message.role === 'user',
  );

  return (
    <aside className="coach-memory" aria-label="Память и полнота профиля">
      <div className="memory-heading">
        <div>
          <p className="eyebrow">Досье опыта</p>
          <h2>Подтверждённая база</h2>
        </div>
        <span>
          {snapshot.dossier.confirmedCount}/{snapshot.memory.length}
        </span>
      </div>

      <section
        className={`dossier-readiness ${
          snapshot.dossier.readiness.complete ? 'is-complete' : ''
        }`}
        aria-label="Готовность досье"
      >
        <div className="dossier-readiness__heading">
          <span aria-hidden="true">
            {snapshot.dossier.readiness.complete ? '✓' : '◌'}
          </span>
          <div>
            <strong>
              {snapshot.dossier.readiness.complete
                ? 'Факт-база собрана'
                : 'Собираем факт-базу'}
            </strong>
            <small>
              {snapshot.dossier.readiness.complete
                ? 'Можно переходить к проверке ролей'
                : 'Не оценка, а прозрачный минимум доказательств'}
            </small>
          </div>
        </div>
        <ul>
          {snapshot.dossier.readiness.checks.map((check) => (
            <li key={check.id} className={check.complete ? 'is-ready' : ''}>
              <span aria-hidden="true">{check.complete ? '✓' : '·'}</span>
              <span>{readinessLabel(check.id)}</span>
              <strong>
                {check.id === 'unknowns'
                  ? check.complete
                    ? 'нет'
                    : check.evidenceCount
                  : check.evidenceCount}
              </strong>
            </li>
          ))}
        </ul>
        <button
          className="dossier-assessment-link"
          onClick={onOpenAssessment}
        >
          {snapshot.assessments.length > 0
            ? `Результаты проверок · ${snapshot.assessments.length}/2`
            : 'Проверить гипотезы ролей'}
          <span aria-hidden="true">→</span>
        </button>
      </section>

      <div className="memory-list">
        {snapshot.memory.length === 0 ? (
          <div className="memory-empty">
            <span aria-hidden="true">＋</span>
            <p>
              Подтверждаемые факты и гипотезы появятся здесь по ходу разговора.
            </p>
          </div>
        ) : (
          snapshot.dossier.sections.map((section) => (
            <section className="dossier-section" key={section.domain}>
              <div className="dossier-section__heading">
                <h3>{dossierDomain(section.domain)}</h3>
                <span>{section.items.length}</span>
              </div>
              {section.items.map((item) => {
                const memory = memoryById.get(item.memoryId);
                if (!memory) return null;
                return (
                  <article className="memory-card" key={memory.id}>
                    <div className="memory-card__meta">
                      <span>{memoryKind(memory.kind)}</span>
                      {memory.sensitive ? <i>чувствительное</i> : null}
                    </div>
                    {editingId === memory.id ? (
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        rows={4}
                        maxLength={1_000}
                        aria-label="Исправленная формулировка"
                      />
                    ) : (
                      <p>{memory.statement}</p>
                    )}
                    {memory.sourceMessageIds.length > 0 ? (
                      <div
                        className="memory-sources"
                        aria-label="Источники факта"
                      >
                        {memory.sourceMessageIds.map((sourceId) => {
                          const answerIndex = userMessages.findIndex(
                            (message) => message.id === sourceId,
                          );
                          return answerIndex >= 0 ? (
                            <a
                              key={sourceId}
                              href={`#message-${sourceId}`}
                            >
                              Ответ {answerIndex + 1}
                            </a>
                          ) : null;
                        })}
                      </div>
                    ) : null}
                    <div className="memory-card__actions">
                      {editingId === memory.id ? (
                        <>
                          <button
                            onClick={() => {
                              void onChange(memory, 'correct', draft);
                              setEditingId(undefined);
                            }}
                            disabled={!draft.trim()}
                          >
                            Сохранить
                          </button>
                          <button onClick={() => setEditingId(undefined)}>
                            Отмена
                          </button>
                        </>
                      ) : (
                        <>
                          {memory.status === 'proposed' ? (
                            <button
                              onClick={() => void onChange(memory, 'confirm')}
                            >
                              {memory.kind === 'open-question'
                                ? 'Закрыть вопрос'
                                : 'Подтвердить'}
                            </button>
                          ) : (
                            <span>
                              ✓{' '}
                              {memory.kind === 'open-question'
                                ? 'вопрос закрыт'
                                : memoryStatus(memory.status)}
                            </span>
                          )}
                          <button
                            onClick={() => {
                              setDraft(memory.statement);
                              setEditingId(memory.id);
                            }}
                          >
                            Исправить
                          </button>
                          <button
                            onClick={() => void onChange(memory, 'delete')}
                          >
                            Удалить
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          ))
        )}
      </div>

      {latest ? (
        <div className="profile-gaps">
          <h3>Полнота разговора</h3>
          <div>
            <span>Уже понятно</span>
            <strong>{latest.completeness.known.length}</strong>
          </div>
          <div>
            <span>Нужно уточнить</span>
            <strong>{latest.completeness.unknown.length}</strong>
          </div>
          {latest.completeness.unknown[0] ? (
            <p>Следующий пробел: {latest.completeness.unknown[0]}</p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function AdminPreview({ user }: { user: AuthUser }) {
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof getProviderStatus>
  >>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void getProviderStatus().then(setStatus).catch((reason) => {
      setError(messageFrom(reason));
    });
  }, []);

  return (
    <section className="admin-preview">
      <div>
        <p className="eyebrow">Администратор</p>
        <h1>Контур работает</h1>
        <p>
          Вы вошли как {user.username}. Полный операционный центр будет
          собран в B089; здесь уже проверяется реальная ролевая граница.
        </p>
      </div>
      <article>
        <span>Маршрут персональных данных</span>
        <strong>
          {status?.personalDataRoute.model ?? (error ? 'Недоступен' : '…')}
        </strong>
        <small>Только основной приватный провайдер</small>
      </article>
      <article>
        <span>Синтетические тесты</span>
        <strong>{status?.syntheticDataRoute.model ?? '…'}</strong>
        <small>Бесплатный маршрут без реальных данных</small>
      </article>
    </section>
  );
}

function PortalLoading() {
  return (
    <section className="coach-centered" aria-busy="true">
      <div className="portal-spinner" aria-hidden="true" />
      <p>Открываем защищённый карьерный контур…</p>
    </section>
  );
}

function memoryKind(kind: CandidateMemory['kind']): string {
  const labels: Record<CandidateMemory['kind'], string> = {
    fact: 'Факт',
    preference: 'Предпочтение',
    hypothesis: 'Гипотеза',
    'open-question': 'Открытый вопрос',
  };
  return labels[kind];
}

function dossierDomain(domain: CandidateMemory['domain']): string {
  const labels: Record<CandidateMemory['domain'], string> = {
    responsibility: 'Ответственность',
    outcome: 'Результаты',
    skill: 'Навыки в действии',
    preference: 'Что подходит',
    constraint: 'Ограничения',
    gap: 'Пробелы и объяснения',
    'role-evidence': 'Сигналы роли',
    other: 'Другие факты',
  };
  return labels[domain];
}

function readinessLabel(
  id: CandidateSnapshot['dossier']['readiness']['checks'][number]['id'],
): string {
  const labels = {
    experience: 'Ответственность',
    impact: 'Наблюдаемый результат',
    capability: 'Навык или сигнал роли',
    direction: 'Предпочтения',
    unknowns: 'Открытые вопросы',
  };
  return labels[id];
}

function memoryStatus(status: CandidateMemory['status']): string {
  return status === 'confirmed' ? 'подтверждено' : 'исправлено';
}

function messageFrom(reason: unknown): string {
  return reason instanceof CoachApiError || reason instanceof Error
    ? reason.message
    : 'Не удалось завершить действие.';
}
