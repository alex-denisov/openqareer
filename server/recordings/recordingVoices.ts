import type { SqliteInterviewRecordingRepository } from '../data/sqliteInterviewRecordingRepository';
import type { DebriefLine } from '../domain/interviewDebrief';
import type { DebriefVoicesView } from '../domain/interviewDebriefView';
import { applyVoices, voiceSummary } from '../domain/interviewVoices';
import { createHash } from 'node:crypto';

/** Ключ деления голосов — расшифровка без говорящих: новая расшифровка — новое деление. */
export function voicesHash(lines: readonly DebriefLine[]): string {
  const plain = lines.map(({ startMs, endMs, text }) => [startMs, endMs, text]);
  return createHash('sha256').update(JSON.stringify(plain)).digest('hex');
}

export interface VoicedTranscript {
  readonly lines: DebriefLine[];
  readonly voices: DebriefVoicesView;
}

/**
 * Загруженный файл: голоса из деления модели, говорящие — после подтверждения кандидатом.
 * Деление от другой расшифровки не применяется.
 */
export function voicedTranscript(
  repository: SqliteInterviewRecordingRepository,
  recordingId: string,
  raw: readonly DebriefLine[],
): VoicedTranscript {
  const stored = repository.getVoices(recordingId);
  const current = stored && stored.transcriptHash === voicesHash(raw) ? stored : null;
  if (!current) return { lines: [...raw], voices: { status: 'none', candidate: null, items: [] } };
  if (current.status === 'failed' || !current.labels) {
    return { lines: [...raw], voices: { status: 'failed', candidate: null, items: [] } };
  }
  const candidate = current.candidateVoice;
  return {
    lines: candidate ? applyVoices(raw, current.labels, candidate) : [...raw],
    voices: { status: 'ready', candidate, items: voiceSummary(raw, current.labels) },
  };
}
