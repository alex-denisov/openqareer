import type {
  CandidateStatusState,
  CandidateStatusToday,
} from '../../../../shared/candidateStatus';
import { apiFetch, readData } from '../../coach/apiClient';

const STATUS_API = '/api/v1/candidate/status';

/** Набор и порядок модулей «Сегодня» при выбранном статусе (B665). */
export async function getStatusToday(signal?: AbortSignal): Promise<CandidateStatusToday> {
  const response = await apiFetch(`${STATUS_API}/today`, { signal });
  const data = await readData<{ readonly today: CandidateStatusToday }>(response);
  return data.today;
}

/** «Вернуть прежний»: доступно до конца дня, в который статус сменили. */
export async function revertStatus(): Promise<CandidateStatusState> {
  const response = await apiFetch(`${STATUS_API}/revert`, { method: 'POST' });
  return readData<CandidateStatusState>(response);
}
