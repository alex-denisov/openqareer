import './adaptation-proposal.css';
import { useEffect, useId, useState } from 'react';
import type { AdaptationContext, AdaptationTaskSuggestion } from '../../../shared/adaptationCoach';
import type { CoachTurnSubject } from '../coach/coachApi';
import { apiFetch, readDataObject, apiErrorMessage, throwApiError } from '../coach/apiClient';
import { ADAPTATION_SAVED_EVENT } from './adaptationDiscussion';

export function AdaptationTaskProposal(props: ProposalProps) {
  const state = useProposalState(props);
  if (state.status === 'dismissed') return null;
  return <section className="career-diary-state adaptation-task-proposal" aria-label="Предложение задачи адаптации" aria-busy={state.busy}>
    <h3>Предложение задачи</h3>
    {!state.sameContext ? <p className="career-diary-note">Предложение относится к другому плану или этапу. Текущий план не изменится.</p> : null}
    <p className="career-diary-note">{props.context.label}. Предложено консультантом; до подтверждения план не меняется.</p>
    {state.status === 'applied' ? <p role="status">Изменение плана сохранено.</p>
      : state.status !== 'available' || !state.sameContext || props.context.readOnly
        ? <p role="status">{state.status === 'loading' ? 'Проверяем состояние плана…' : state.status === 'unknown' ? 'Состояние предложения пока неизвестно. Повторите проверку.' : state.status === 'read_only' ? 'План закрыт или больше недоступен для изменений.' : 'План или контекст изменился. Откройте актуальный план и обсудите предложение заново.'}</p>
        : <ProposalForm state={state} />}
    {state.error ? <p role="alert" className="career-diary-error">{state.error}</p> : null}
    {state.status === 'unknown' ? <button className="career-btn is-ghost" type="button" onClick={() => state.setRevision(value => value + 1)}>Повторить проверку</button> : null}
  </section>;
}

interface ProposalProps {
  turnKey: string; context: AdaptationContext; suggestion: AdaptationTaskSuggestion; currentSubject?: CoachTurnSubject;
}
function useProposalState({ turnKey, context, suggestion, currentSubject }: ProposalProps) {
  const id = useId();
  const [title, setTitle] = useState(suggestion.title), [description, setDescription] = useState(suggestion.description);
  const [dueDate, setDueDate] = useState(suggestion.dueDate ?? ''), [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('loading'), [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<AdaptationTaskSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const url = '/api/v1/coach/adaptation-proposals/' + encodeURIComponent(turnKey);
  const sameContext = currentSubject?.kind === 'adaptation' && currentSubject.id === context.workplaceId && currentSubject.planId === context.planId && currentSubject.adaptationStage === context.stage;
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(url, { signal: controller.signal }).then(readDataObject<{ status: string; target?: AdaptationTaskSuggestion | null }>).then(data => {
      if (!controller.signal.aborted) { setStatus(data.status); setTarget(data.target ?? null); setError(null); }
    }).catch(reason => { if (!controller.signal.aborted) { setStatus('unknown'); setError(apiErrorMessage(reason, 'Не удалось проверить предложение.')); } });
    return () => controller.abort();
  }, [url, revision]);
  async function apply(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !sameContext || status !== 'available') return;
    setBusy(true); setError(null);
    try {
      const response = await apiFetch(url, { method: 'POST', body: JSON.stringify({ title, description, dueDate }) });
      if (!response.ok) await throwApiError(response);
      await readDataObject(response); setStatus('applied');
      window.dispatchEvent(new Event(ADAPTATION_SAVED_EVENT));
    } catch (reason) { setError(apiErrorMessage(reason, 'Не удалось сохранить задачу. Повторите отправку.')); }
    finally { setBusy(false); }
  }
  async function reject() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await apiFetch('/api/v1/coach/proposals/reject', { method: 'POST', body: JSON.stringify({ proposalKey: 'adaptation:' + turnKey }) });
      if (!response.ok) await throwApiError(response);
      await readDataObject(response); setStatus('dismissed');
    } catch (reason) { setError(apiErrorMessage(reason, 'Не удалось отклонить предложение. Повторите отправку.')); }
    finally { setBusy(false); }
  }
  return { id, title, setTitle, description, setDescription, dueDate, setDueDate, editing, setEditing, status, error, busy, sameContext, setRevision, apply, reject, target, isUpdate: Boolean(suggestion.targetTaskId) };
}

function ProposalForm({ state: s }: { state: ReturnType<typeof useProposalState> }) {
  return <form onSubmit={event => void s.apply(event)}>
    {s.target ? <div className="career-diary-note"><p>Текущая задача: {s.target.title}</p><p>{s.target.description}</p><p>Текущий срок: {s.target.dueDate}</p></div> : null}
    {s.editing ? <>
      <label className="career-field" htmlFor={s.id + '-title'}>Название задачи<input id={s.id + '-title'} value={s.title} maxLength={200} required disabled={s.busy} onChange={event => s.setTitle(event.target.value)} /></label>
      <label className="career-field" htmlFor={s.id + '-description'}>Описание задачи<textarea id={s.id + '-description'} value={s.description} maxLength={1500} disabled={s.busy} onChange={event => s.setDescription(event.target.value)} /></label>
    </> : <><p>{s.title}</p><p>{s.description}</p></>}
    <label className="career-field" htmlFor={s.id + '-date'}>Срок задачи<input id={s.id + '-date'} type="date" value={s.dueDate} required disabled={s.busy} onChange={event => s.setDueDate(event.target.value)} /></label>
    <button type="button" className="career-btn is-ghost" disabled={s.busy} onClick={() => s.setEditing(value => !value)}>Изменить предложение</button>
    <button type="submit" className="career-btn" disabled={s.busy || !s.title.trim() || !s.dueDate}>{s.busy ? 'Сохраняем задачу…' : s.isUpdate ? 'Сохранить изменение задачи' : 'Добавить задачу в план'}</button>
    <button type="button" className="career-btn is-ghost" disabled={s.busy} onClick={() => void s.reject()}>Отклонить предложение</button>
  </form>;
}
