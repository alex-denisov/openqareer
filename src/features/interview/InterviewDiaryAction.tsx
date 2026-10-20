import { useRef, useState } from 'react';
import type { CareerDiaryInterviewPractice } from '../../../shared/careerDiary';
import { saveInterviewPractice } from './interviewDiaryApi';
import { InterviewDiaryPractice } from './InterviewDiaryPractice';

export function InterviewDiaryAction({ sessionId }: { readonly sessionId: string }) {
  const [record, setRecord] = useState<CareerDiaryInterviewPractice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [opened, setOpened] = useState(false);
  const inFlight = useRef(false);
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setWriting(true); setError(null);
    try { setRecord(await saveInterviewPractice(sessionId)); }
    catch { setError('Не удалось подтвердить сохранение. Повторите: вторая запись не появится.'); }
    finally { setWriting(false); inFlight.current = false; }
  };
  return <div>
    {record ? <><p role="status">Запись сохранена в карьерном дневнике.</p><button type="button" className="career-btn career-btn-secondary" onClick={() => setOpened(value => !value)} aria-expanded={opened}>{opened ? 'Скрыть запись' : 'Открыть запись дневника'}</button></> : <button type="button" className="career-btn career-btn-secondary" disabled={writing} aria-busy={writing} onClick={() => void save()}>{writing ? 'Сохраняем' : error ? 'Повторить запись в дневник' : 'Записать в дневник'}</button>}
    {error ? <p role="alert">{error}</p> : null}
    {opened && record ? <InterviewDiaryPractice record={record} /> : null}
  </div>;
}
