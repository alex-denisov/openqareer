import type { ApplicationView } from '../../../../../server/domain/applicationDerivedFields';
import type { InterviewDebriefView } from '../../../../../server/domain/interviewDebriefView';
import { apiFetch, readDataObject } from '../../../coach/apiClient';
import { findResponse } from './prepApi';

const debriefPath = (applicationId: string, tail = '') =>
  `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/debrief${tail}`;

export interface DebriefData {
  readonly response: ApplicationView;
  /** `null` — у отклика нет интервью: разбирать нечего. */
  readonly debrief: InterviewDebriefView | null;
}

async function readDebrief(response: Response): Promise<InterviewDebriefView | null> {
  if (response.status === 404) return null;
  return readDataObject<InterviewDebriefView>(response);
}

/** Разбор отклика: последнее интервью, его запись и расшифровка. `null` — отклика нет. */
export async function loadDebrief(responseId: string, signal: AbortSignal): Promise<DebriefData | null> {
  const response = await findResponse(responseId, signal);
  if (!response) return null;
  const debrief = await readDebrief(await apiFetch(debriefPath(response.id), { signal }));
  return { response, debrief };
}

/** Разбор по id отклика без поиска самого отклика: для строки «Запись … есть» в O1c. */
export async function loadInterviewDebrief(
  applicationId: string,
  signal: AbortSignal,
): Promise<InterviewDebriefView | null> {
  return readDebrief(await apiFetch(debriefPath(applicationId), { signal }));
}

/** Один вызов модели на расшифровку; повтор по той же расшифровке берёт сохранённый разбор. */
export async function analyzeDebrief(applicationId: string): Promise<InterviewDebriefView> {
  const response = await apiFetch(debriefPath(applicationId, '/analysis'), { method: 'POST' });
  return readDataObject<InterviewDebriefView>(response);
}

export async function saveDebriefNotes(
  applicationId: string,
  notes: string,
): Promise<InterviewDebriefView> {
  const response = await apiFetch(debriefPath(applicationId, '/notes'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
  return readDataObject<InterviewDebriefView>(response);
}

/** «Верно — в отклик»: договорённость дописывается в заметки отклика. */
export async function acceptAgreement(applicationId: string, text: string): Promise<void> {
  const response = await apiFetch(debriefPath(applicationId, '/agreements'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  await readDataObject<object>(response);
}

/** Имя собеседника для расшифровки загруженного файла. */
export async function saveInterviewerName(applicationId: string, name: string): Promise<void> {
  const response = await apiFetch(debriefPath(applicationId, '/interviewer'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  await readDataObject<object>(response);
}

/** I4c «Чей голос»: деление голосов загруженного файла (один вызов модели на расшифровку). */
export async function splitVoices(applicationId: string): Promise<InterviewDebriefView> {
  const response = await apiFetch(debriefPath(applicationId, '/voices'), { method: 'POST' });
  return readDataObject<InterviewDebriefView>(response);
}

/** «Подтвердить голоса»: какой голос — кандидата. */
export async function confirmVoices(
  applicationId: string,
  candidate: 1 | 2,
): Promise<InterviewDebriefView> {
  const response = await apiFetch(debriefPath(applicationId, '/voices'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate }),
  });
  return readDataObject<InterviewDebriefView>(response);
}
