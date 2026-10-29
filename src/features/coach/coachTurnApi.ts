import { apiFetch, CoachApiError as CoachApiErrorClass, readDataObject } from './apiClient';
import type { CoachResult, CoachTurnStage, CoachTurnSubject } from './coachApi';
import { RESULT_WAIT_MS, receiveCoachResult } from './coachResultDelivery';
import { streamCoachResult } from './coachResultStream';

export async function sendCoachTurn(input: {
  content: string;
  marketQuery?: string;
  idempotencyKey?: string;
  messageId?: string;
  stage?: CoachTurnStage;
  subject?: CoachTurnSubject;
  isService?: boolean;
  /** 29.10: the reply so far while it is written; `''` means start over. */
  onMessageText?: (text: string) => void;
  /** Cancels the stream only; the saved result is still read. */
  streamSignal?: AbortSignal;
}): Promise<CoachResult> {
  const key = input.idempotencyKey ?? crypto.randomUUID();
  let receipted = false;
  try {
    const response = await apiFetch('/api/v1/coach/turn?delivery=receipt', {
      signal: AbortSignal.timeout(20_000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({
        messageId: input.messageId ?? crypto.randomUUID(),
        content: input.content,
        marketQuery: input.marketQuery,
        stage: input.stage,
        subject: input.subject,
        isService: input.isService,
      }),
    });
    const data = await readDataObject<CoachResult & { status?: string }>(response);
    // Older immutable releases return the complete result; preserve compatibility.
    if (typeof data.message === 'string') return data;
    if (data.status !== 'pending' && data.status !== 'completed') {
      throw new CoachApiErrorClass(
        'Сервис вернул ответ неожиданной формы.',
        'malformed_response',
        true,
      );
    }
    receipted = true;
  } catch (error) {
    if (
      !(error instanceof CoachApiErrorClass) ||
      !['network_error', 'malformed_response'].includes(error.code)
    )
      throw error;
    // The POST may have succeeded: read the saved operation, never generate again.
  }
  return readTurnResult(key, receipted ? input : {});
}

/** After a receipt the stream shows the reply as it is written; the saved result is the answer. */
async function readTurnResult(
  key: string,
  input: { onMessageText?: (text: string) => void; streamSignal?: AbortSignal },
): Promise<CoachResult> {
  if (!input.onMessageText) return receiveCoachResult<CoachResult>(key);
  const startedAt = Date.now();
  const streamed = await streamCoachResult<CoachResult>(
    key,
    input.onMessageText,
    input.streamSignal,
  );
  if (streamed) return streamed;
  // The stream and the fallback share one wait: a dead stream must not double it.
  const left = Math.max(30_000, RESULT_WAIT_MS - (Date.now() - startedAt));
  return receiveCoachResult<CoachResult>(key, left);
}
