import { useCallback, useEffect, useRef, useState } from 'react';
import type { CareerDiaryInterviewPractice } from '../../../shared/careerDiary';
import { deleteInterviewPractice, listInterviewPractices } from '../interview/interviewDiaryApi';
import { InterviewDiaryPractice } from '../interview/InterviewDiaryPractice';

export function CareerDiaryInterviewPractices() {
  const [records, setRecords] = useState<readonly CareerDiaryInterviewPractice[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(async (next?: string, signal?: AbortSignal) => {
    if (!signal && inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const page = await listInterviewPractices(next, signal);
      if (!signal?.aborted) { setRecords(current => next ? [...current, ...page.items] : page.items); setCursor(page.nextCursor); }
    } catch { if (!signal?.aborted) setError('Тренировки не загрузились. Повторите запрос.'); }
    finally { inFlight.current = false; if (!signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(undefined, controller.signal); return () => controller.abort(); }, [load]);
  const remove = async (id: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await deleteInterviewPractice(id); setRecords(current => current.filter(record => record.id !== id)); setConfirmation(null); }
    catch { setError('Запись не удалена. Повторите удаление.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <section className="career-diary-records" aria-label="Тренировки интервью" aria-busy={busy}>
    <h2>Тренировки интервью</h2>
    <p>Только записи, которые вы сохранили из мок-интервью. Они не добавляются в достижения профиля.</p>
    {records.map(record => <div key={record.id}><InterviewDiaryPractice record={record} />
      {confirmation === record.id ? <><p>Удалить запись тренировки из дневника? Это действие нельзя отменить.</p><button type="button" className="career-btn is-danger" disabled={busy} onClick={() => void remove(record.id)}>Удалить запись тренировки</button><button type="button" className="career-btn is-ghost" onClick={() => setConfirmation(null)}>Отмена</button></> : <button type="button" className="career-btn is-ghost" disabled={busy} onClick={() => setConfirmation(record.id)}>Удалить запись</button>}
    </div>)}
    {busy ? <p role="status">Загружаем записи.</p> : null}
    {!busy && !error && records.length === 0 ? <p>Сохранённых тренировок пока нет.</p> : null}
    {error ? <><p role="alert">{error}</p><button className="career-btn is-ghost" onClick={() => void load()}>Повторить</button></> : null}
    {cursor ? <button type="button" className="career-btn is-ghost" disabled={busy} onClick={() => void load(cursor)}>Показать ещё тренировки</button> : null}
  </section>;
}
