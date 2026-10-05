import { useEffect, useId, useState, type FormEvent } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { PaywallModal } from '../tariffs/PaywallModal';
import { createDraft, DraftApiError, listDrafts, updateDraft, type LinkedinDraft } from './linkedinDraftApi';
import type { LinkedinSafetyStopReason } from './linkedinActionSafetyApi';
import { useLinkedinActionSafetyStop } from './useLinkedinActionSafetyStop';
import './linkedinDraftCard.css';
const STATUS = { draft: 'черновик', copied: 'скопирован', rejected: 'отклонён' };
const GENERATION_ERROR = 'Не получилось подготовить черновик. Попробуйте ещё раз';

function linkedinStopCopy(reason: LinkedinSafetyStopReason | null): string {
  switch (reason) {
    case 'challenge_required':
      return 'LinkedIn запросил проверку. Завершите её вручную перед возобновлением.';
    case 'platform_restricted':
      return 'LinkedIn ограничил запрос. Проверьте подключение перед возобновлением.';
    case 'unexpected_page':
      return 'Получен неожиданный ответ LinkedIn. Проверьте его вручную перед возобновлением.';
    case 'provider_error':
      return 'Исполнитель не подтвердил результат. Действия ждут ручной проверки.';
    case 'manual_pause':
      return 'Пауза включена вручную.';
    case 'platform_pause':
      return 'Пауза действует на уровне сервиса; снять её может администратор.';
    default:
      return 'Действия остановлены до ручной проверки.';
  }
}

function useLinkedinDraftCard() {
  const safetyStop = useLinkedinActionSafetyStop();
  const [kind, setKind] = useState<LinkedinDraft['kind']>('comment');
  const [topic, setTopic] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [recent, setRecent] = useState<readonly LinkedinDraft[]>([]);
  const [current, setCurrent] = useState<LinkedinDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paywall, setPaywall] = useState(false);
  useEffect(() => {
    let active = true;
    void listDrafts().then(items => { if (active) setRecent(Array.isArray(items) ? items : []); }, () => {
      if (active) setError('Не получилось загрузить последние черновики.');
    });
    return () => { active = false; };
  }, []);
  const remember = (draft: LinkedinDraft) => setRecent(items => [draft, ...items.filter(item => item.id !== draft.id)].slice(0, 3));
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!topic.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const draft = await createDraft({ kind, topic: topic.trim(), ...(kind === 'comment' && sourceText.trim() ? { sourceText: sourceText.trim() } : {}) });
      setCurrent(draft); remember(draft);
    } catch (reason) {
      if (reason instanceof DraftApiError && reason.status === 402) setPaywall(true);
      else setError(reason instanceof DraftApiError && [429, 503].includes(reason.status) ? reason.message : GENERATION_ERROR);
    } finally { setBusy(false); }
  }
  async function changeStatus(status: 'copied' | 'rejected') {
    if (!current || busy) return;
    setBusy(true); setError('');
    try {
      if (status === 'copied') await navigator.clipboard.writeText(current.text);
      const draft = await updateDraft(current.id, status);
      remember(draft); setCurrent(status === 'rejected' ? null : draft);
    } catch { setError(status === 'copied' ? 'Не получилось скопировать и сохранить статус. Попробуйте ещё раз.' : 'Не получилось отклонить черновик. Попробуйте ещё раз.'); }
    finally { setBusy(false); }
  }
  return {
    kind, setKind, topic, setTopic, sourceText, setSourceText, recent, current,
    busy, error, paywall, setPaywall, prepare, changeStatus,
    ...safetyStop,
  };
}

export function LinkedinDraftCard({ onOpenTariffs }: { readonly onOpenTariffs?: () => void }) {
  const id = useId();
  const {
    kind, setKind, topic, setTopic, sourceText, setSourceText, recent, current,
    busy, error, paywall, setPaywall, prepare, changeStatus,
    linkedinSafetyStop, safetyStatusLoading, safetyError, safetyNotice, resumingLinkedin, resumeLinkedinManually,
  } = useLinkedinDraftCard();
  return <section className="career-drafts" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>Черновики для LinkedIn</h2>
    <p>Готовим текст — публикуете вы сами</p>
    {safetyStatusLoading ? <p className="career-drafts-safety-notice" role="status" aria-busy="true">Проверяем статус действий LinkedIn…</p> : null}
    {linkedinSafetyStop?.paused ? <div className="career-drafts-safety-stop" role="status" aria-busy={resumingLinkedin}>
      <WarningCircle className="career-drafts-safety-stop__icon" aria-hidden="true" />
      <div className="career-drafts-safety-stop__content">
        <p className="career-drafts-safety-stop__title"><strong>Действия LinkedIn приостановлены</strong></p>
        <p>{linkedinStopCopy(linkedinSafetyStop.reason)}</p>
        {linkedinSafetyStop.canResume ? <button type="button" className="career-btn career-btn-secondary" disabled={resumingLinkedin} aria-busy={resumingLinkedin} onClick={() => void resumeLinkedinManually()}>
          {resumingLinkedin ? 'Снимаем паузу…' : 'Возобновить вручную'}
        </button> : null}
      </div>
    </div> : null}
    {safetyError ? <p className="career-drafts-safety-error" role="alert">{safetyError}</p> : null}
    {safetyNotice ? <p className="career-drafts-safety-notice" role="status">{safetyNotice}</p> : null}
    <form onSubmit={event => void prepare(event)} aria-busy={busy}>
      <label htmlFor={`${id}-topic`}>Тема</label>
      <input id={`${id}-topic`} value={topic} onChange={event => setTopic(event.target.value)} maxLength={200} required disabled={busy} />
      <div className="career-drafts-kinds" role="group" aria-label="Вид черновика">
        {(['comment', 'post'] as const).map(value => <button className="career-btn career-btn-secondary" type="button" key={value} aria-pressed={kind === value} disabled={busy} onClick={() => setKind(value)}>{value === 'comment' ? 'Комментарий' : 'Пост'}</button>)}
      </div>
      {kind === 'comment' ? <><label htmlFor={`${id}-source`}>Текст поста, на который отвечаете (необязательно)</label><textarea id={`${id}-source`} value={sourceText} onChange={event => setSourceText(event.target.value)} maxLength={2000} rows={2} disabled={busy} /></> : null}
      <button type="submit" className="career-btn career-btn-secondary" disabled={busy}>{busy ? 'Готовлю…' : 'Подготовить черновик'}</button>
    </form>
    {error ? <p role="alert">{error}</p> : null}
    {current ? <div className="career-drafts-result" aria-live="polite"><p>{current.text}</p><div className="career-drafts-kinds"><button type="button" className="career-btn career-btn-secondary" disabled={busy} onClick={() => void changeStatus('copied')}>{current.status === 'copied' ? 'Скопировано' : 'Скопировать'}</button><button type="button" className="career-btn career-btn-secondary" disabled={busy} onClick={() => void changeStatus('rejected')}>Отклонить</button></div></div> : null}
    {recent.length ? <ul className="career-drafts-recent" aria-label="Последние черновики">{recent.map(draft => <li key={draft.id}>{draft.topic} · <span>{STATUS[draft.status]}</span></li>)}</ul> : null}
    <PaywallModal isOpen={paywall} onClose={() => setPaywall(false)} onNavigate={() => onOpenTariffs?.()} />
  </section>;
}
