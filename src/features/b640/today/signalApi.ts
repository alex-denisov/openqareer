import type {
  StatusSignal,
  StatusSignalAnswer,
  StatusSignalKind,
  StatusSignalState,
} from '../../../../shared/statusSignal';
import { apiFetch, readData } from '../../coach/apiClient';
import { buildNodePath } from '../routes';

const SIGNAL_API = '/api/v1/candidate/status/signal';

/** Сигнал «Сегодня» и последний ответ, который ещё можно отменить (B691). */
export async function getStatusSignal(signal?: AbortSignal): Promise<StatusSignalState> {
  const response = await apiFetch(SIGNAL_API, { signal });
  return readData<StatusSignalState>(response);
}

export async function answerStatusSignal(
  kind: StatusSignalKind,
  answer: StatusSignalAnswer,
): Promise<StatusSignalState> {
  const response = await apiFetch(`${SIGNAL_API}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, answer }),
  });
  return readData<StatusSignalState>(response);
}

export async function undoStatusSignalAnswer(): Promise<StatusSignalState> {
  const response = await apiFetch(`${SIGNAL_API}/answer/undo`, { method: 'POST' });
  return readData<StatusSignalState>(response);
}

/** После «Верно»: выбор статуса с предложенным вариантом; меняет статус сам кандидат. */
export function signalStatusPath(suggest: StatusSignal['suggest']): string {
  const query = new URLSearchParams({ status: suggest.status });
  if (suggest.targetProfession) query.set('profession', suggest.targetProfession);
  return `${buildNodePath('s02')}?${query.toString()}`;
}
