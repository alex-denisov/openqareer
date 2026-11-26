import { apiFetch, readDataObject } from '../../../coach/apiClient';
import {
  encodeWav,
  MAX_UPLOAD_SECONDS,
  mixToMono,
  splitChunks,
  UPLOAD_SAMPLE_RATE,
  type AudioChunk,
} from './audioChunks';
import type { CreatedRecording } from './recordingBridge';

export class UploadError extends Error {
  constructor(readonly code: 'decode' | 'too_long' | 'upload') {
    super(code);
  }
}

/** Файл в моно 16 кГц: браузер сам пересчитывает частоту при разборе. */
async function decodeFile(file: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: UPLOAD_SAMPLE_RATE });
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    if (audio.duration > MAX_UPLOAD_SECONDS) throw new UploadError('too_long');
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    return mixToMono(channels);
  } catch (error) {
    throw error instanceof UploadError ? error : new UploadError('decode');
  } finally {
    void context.close();
  }
}

async function createUploadRecording(
  applicationId: string,
  interviewId: string,
): Promise<CreatedRecording> {
  const path = `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/interviews/${encodeURIComponent(interviewId)}/recordings`;
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'upload' }),
  });
  return readDataObject<CreatedRecording>(response);
}

async function sendChunk(created: CreatedRecording, chunk: AudioChunk, startedAt: number) {
  const form = new FormData();
  form.set('track', 'upload');
  form.set('segment', String(chunk.index));
  form.set('startedAt', new Date(startedAt + chunk.startMs).toISOString());
  form.set('durationMs', String(chunk.durationMs));
  form.set('file', new Blob([encodeWav(chunk.samples)], { type: 'audio/wav' }), `part-${chunk.index}.wav`);
  const response = await fetch(created.uploadUrl, { method: 'POST', headers: created.headers, body: form });
  if (!response.ok) throw new UploadError('upload');
}

async function finishUpload(recordingId: string, segments: number, failed: number) {
  const response = await apiFetch(
    `/api/v1/candidate/recordings/${encodeURIComponent(recordingId)}/finish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, failed }),
    },
  );
  await readDataObject<object>(response);
}

/**
 * Загрузить файл интервью: разобрать, отправить кусками, закрыть запись. Кусок, который
 * не ушёл, считается пробелом расшифровки — разбор строится по остальным.
 */
export async function uploadInterviewFile(
  file: Blob,
  target: { readonly applicationId: string; readonly interviewId: string },
  onProgress: (sent: number, total: number) => void,
): Promise<{ readonly durationMs: number }> {
  const samples = await decodeFile(file);
  const chunks = splitChunks(samples);
  const created = await createUploadRecording(target.applicationId, target.interviewId);
  const startedAt = Date.now();
  let failed = 0;
  for (const chunk of chunks) {
    try {
      await sendChunk(created, chunk, startedAt);
    } catch {
      failed += 1;
    }
    onProgress(chunk.index + 1, chunks.length);
  }
  if (failed === chunks.length) throw new UploadError('upload');
  await finishUpload(created.recordingId, chunks.length - failed, failed);
  return { durationMs: Math.round((samples.length / UPLOAD_SAMPLE_RATE) * 1000) };
}

export function uploadErrorText(error: unknown): string {
  const code = error instanceof UploadError ? error.code : 'upload';
  if (code === 'decode') return 'Файл не открылся. Подойдёт запись в m4a, mp3, wav или ogg.';
  if (code === 'too_long') return 'Запись длиннее трёх часов. Загрузите файл одного интервью.';
  return 'Запись не загрузилась. Проверьте связь и загрузите файл ещё раз.';
}
