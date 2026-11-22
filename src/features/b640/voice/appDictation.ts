import { apiFetch, readDataObject } from '../../coach/apiClient';
import {
  launchRecording,
  stopRecording,
  type CreatedRecording,
} from '../interview/data/recordingBridge';

/**
 * Диктовка в .app, где нет распознавания речи браузером (решение 22.11): запись B642
 * только с микрофона, расшифровка Whisper на сервере. Текст читается один раз, затем
 * запись удаляется — диктовка не хранится.
 */
export const POLL_MS = 2_000;
const WAIT_LIMIT_MS = 3 * 60_000;

interface DictationView {
  readonly status: 'recording' | 'transcribing' | 'ready' | 'failed';
  readonly transcript: ReadonlyArray<{ readonly text: string }> | null;
}

export async function beginAppDictation(): Promise<CreatedRecording> {
  const response = await apiFetch('/api/v1/candidate/dictations', { method: 'POST' });
  const created = await readDataObject<CreatedRecording>(response);
  await launchRecording(created);
  return created;
}

const recordingPath = (id: string) => `/api/v1/candidate/recordings/${encodeURIComponent(id)}`;

async function readView(id: string, signal: AbortSignal): Promise<DictationView> {
  return readDataObject<DictationView>(await apiFetch(recordingPath(id), { signal }));
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

async function waitForText(id: string, signal: AbortSignal): Promise<string> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (Date.now() < deadline) {
    const view = await readView(id, signal);
    if (view.status === 'ready')
      return (view.transcript ?? [])
        .map((l) => l.text)
        .join(' ')
        .trim();
    if (view.status === 'failed') throw new Error('transcription_failed');
    await pause(POLL_MS, signal);
  }
  throw new Error('transcription_timeout');
}

/** Остановить, дождаться текста и удалить запись; пустая речь — ошибка распознавания. */
export async function finishAppDictation(id: string, signal: AbortSignal): Promise<string> {
  try {
    await stopRecording(id);
    const text = await waitForText(id, signal);
    if (!text) throw new Error('speech_empty');
    return text;
  } finally {
    // Не удалилась — запись уберёт срок хранения B642; ответ кандидату от этого не зависит.
    void apiFetch(recordingPath(id), { method: 'DELETE' }).catch(() => undefined);
  }
}
