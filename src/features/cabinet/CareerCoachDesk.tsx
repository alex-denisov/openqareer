import { useEffect, useRef, useState } from 'react';
import { CheckCircle, PaperPlaneTilt, Sparkle, UserCircle } from '@phosphor-icons/react';
import {
  CoachApiError,
  sendCoachTurn,
  type CandidateSnapshot,
  type CoachResult,
} from '../coach/coachApi';
import type { CareerJourney } from '../journey/careerJourneyEngine';

interface CareerCoachDeskProps {
  snapshot?: CandidateSnapshot;
  journey?: CareerJourney;
  marketQuery?: string;
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export function CareerCoachDesk(props: CareerCoachDeskProps) {
  const state = useCoachDesk(props);
  return (
    <section className="career-coach-desk" aria-labelledby="career-coach-title">
      <CoachHeader />
      <div className="career-coach-topic">
        <span>Текущий фокус</span>
        <strong>{props.journey?.nextAction.headline ?? props.marketQuery ?? 'Собрать карьерную картину'}</strong>
      </div>
      <CoachHistory
        history={state.history}
        messages={state.messages}
        latestResult={state.latestResult ?? undefined}
        loading={props.loading}
        sending={state.sending}
      />
      <ProfileContext snapshot={props.snapshot} />
      <CoachComposer {...state} />
      {state.error ? <p className="career-expert-error" role="alert">{state.error}</p> : null}
    </section>
  );
}

function useCoachDesk({ snapshot, marketQuery, onRefresh }: CareerCoachDeskProps) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [liveResult, setLiveResult] = useState<CoachResult>();
  const history = useRef<HTMLDivElement>(null);
  const messages = (snapshot?.messages ?? []).slice(-10);
  const storedResult = [...(snapshot?.turns ?? [])]
    .reverse()
    .find((turn) => turn.status === 'completed' && turn.result)?.result;
  useEffect(() => {
    history.current?.scrollTo({ top: history.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, liveResult]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const message = content.trim();
    if (!message || sending) return;
    setSending(true);
    setError(undefined);
    try {
      setLiveResult(await sendCoachTurn({ content: message, marketQuery: marketQuery?.trim() || undefined }));
      setContent('');
      await onRefresh();
    } catch (reason) {
      setError(coachError(reason));
    } finally {
      setSending(false);
    }
  }
  return { content, setContent, sending, error, history, messages, latestResult: liveResult ?? storedResult, submit };
}

function CoachHeader() {
  return (
    <header className="career-cabinet-panel-heading">
      <div><span className="career-cabinet-kicker">Рабочий диалог</span><h2 id="career-coach-title">Диалог со стратегом</h2></div>
      <span className="career-online-state"><i aria-hidden="true" /> защищён</span>
    </header>
  );
}

function CoachHistory({ history, messages, latestResult, loading, sending }: {
  history: React.Ref<HTMLDivElement>;
  messages: CandidateSnapshot['messages'];
  latestResult?: CoachResult;
  loading: boolean;
  sending: boolean;
}) {
  return (
    <div className="career-coach-history" ref={history} aria-live="polite">
      {!messages.length && !loading ? <CoachStarter /> : null}
      {messages.map((message) => <CoachMessage key={message.id} message={message} />)}
      {latestResult?.nextQuestion ? (
        <article className="career-coach-next-question"><span>Следующее уточнение</span><p>{latestResult.nextQuestion}</p></article>
      ) : null}
      {sending ? <p className="career-cabinet-loading">Стратег сверяет факты…</p> : null}
    </div>
  );
}

function CoachStarter() {
  return (
    <article className="career-coach-starter"><Sparkle size={18} weight="fill" /><div>
      <strong>Начнём с одного точного вопроса</strong>
      <p>Какой результат вашей работы за последние два года лучше всего показывает уровень ответственности?</p>
    </div></article>
  );
}

function CoachMessage({ message }: { message: CandidateSnapshot['messages'][number] }) {
  return (
    <article className={`career-coach-message is-${message.role}`}>
      <span>{message.role === 'assistant' ? <Sparkle size={15} weight="fill" /> : <UserCircle size={16} />}{message.role === 'assistant' ? 'Стратег' : 'Вы'}</span>
      {message.content.split('\n').filter(Boolean).map((paragraph, index) => <p key={`${message.id}-${index}`}>{paragraph}</p>)}
    </article>
  );
}

function ProfileContext({ snapshot }: { snapshot?: CandidateSnapshot }) {
  const memory = (snapshot?.memory ?? []).filter((item) => item.status === 'confirmed').slice(0, 4);
  return (
    <div className="career-profile-context-strip"><span>Контекст профиля</span><div>
      {memory.map((item) => <small key={item.id}>{item.statement}</small>)}
      {!snapshot?.dossier.confirmedCount ? <small>Подтверждённые факты появятся здесь</small> : null}
    </div></div>
  );
}

function CoachComposer({ content, setContent, sending, submit }: ReturnType<typeof useCoachDesk>) {
  return (
    <form className="career-coach-composer-inline" onSubmit={submit}>
      <label htmlFor="career-cabinet-message">Ваш ответ</label>
      <div><textarea id="career-cabinet-message" rows={4} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Расскажите о результате или задайте вопрос…" />
        <button type="submit" disabled={sending || !content.trim()} aria-label="Отправить сообщение стратегу">
          {sending ? <CheckCircle size={19} /> : <PaperPlaneTilt size={19} weight="fill" />}
        </button>
      </div>
      <small>Ответ может изменить профиль только как предложение на проверку.</small>
    </form>
  );
}

function coachError(reason: unknown): string {
  if (reason instanceof CoachApiError || reason instanceof Error) return reason.message;
  return 'Не удалось сохранить ответ. Повторите отправку.';
}
