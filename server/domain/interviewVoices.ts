import type { DebriefLine } from './interviewDebrief';

/**
 * B642, I4c «Чей голос»: Whisper не делит загруженный файл по голосам. Модель отмечает,
 * с какой строки говорит другой голос; кандидат подтверждает, какой голос — его.
 */
export type VoiceId = 1 | 2;

export interface VoiceSummaryItem {
  readonly voice: VoiceId;
  readonly sharePercent: number;
  readonly quote: string;
}

/** Сколько строк уходит модели: длинное интервью ~600 реплик. */
export const VOICE_INPUT_LINES = 1_500;
const QUOTE_CHARS = 90;

const two = (value: number) => String(value).padStart(2, '0');
const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1_000);
  return `${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`;
};

export function voiceInputText(lines: readonly DebriefLine[]): string {
  return lines
    .slice(0, VOICE_INPUT_LINES)
    .map((line, index) => `${index} [${clock(line.startMs)}] ${line.text}`)
    .join('\n');
}

function isVoice(value: unknown): value is VoiceId {
  return value === 1 || value === 2;
}

function changesOf(raw: unknown): Array<{ line: number; voice: VoiceId }> | null {
  const changes = (raw as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) return null;
  const parsed = changes.map((item) => item as { line?: unknown; voice?: unknown });
  if (!parsed.every((c) => Number.isInteger(c.line) && isVoice(c.voice))) return null;
  return parsed
    .map((c) => ({ line: c.line as number, voice: c.voice as VoiceId }))
    .sort((a, b) => a.line - b.line);
}

/** Смены голоса → голос каждой строки; `null` — ответ не годится (оба голоса обязательны). */
export function acceptVoiceChanges(raw: unknown, count: number): VoiceId[] | null {
  const changes = changesOf(raw);
  if (!changes || changes[0]?.line !== 0) return null;
  if (changes.some((c) => c.line >= count)) return null;
  const labels: VoiceId[] = [];
  for (let index = 0, at = 0; index < count; index += 1) {
    while (changes[at + 1] && changes[at + 1]!.line <= index) at += 1;
    labels.push(changes[at]!.voice);
  }
  return new Set(labels).size === 2 ? labels : null;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length <= QUOTE_CHARS ? flat : `${flat.slice(0, QUOTE_CHARS - 1).trimEnd()}…`;
}

/** Доля речи по времени и самая длинная реплика каждого голоса. */
export function voiceSummary(
  lines: readonly DebriefLine[],
  labels: readonly VoiceId[],
): VoiceSummaryItem[] {
  const spoken = (voice: VoiceId) =>
    lines.reduce(
      (sum, line, i) => (labels[i] === voice ? sum + Math.max(0, line.endMs - line.startMs) : sum),
      0,
    );
  const total = spoken(1) + spoken(2) || 1;
  return ([1, 2] as const).map((voice) => {
    const own = lines.filter((_, i) => labels[i] === voice);
    const longest = own.reduce(
      (best, line) => (line.text.length > best.length ? line.text : best),
      '',
    );
    return {
      voice,
      sharePercent: Math.round((spoken(voice) * 100) / total),
      quote: shorten(longest),
    };
  });
}

/** Подтверждённый голос кандидата раскладывает строки по говорящим. */
export function applyVoices(
  lines: readonly DebriefLine[],
  labels: readonly VoiceId[],
  candidate: VoiceId,
): DebriefLine[] {
  if (labels.length !== lines.length) return [...lines];
  return lines.map((line, i) => ({
    ...line,
    speaker: labels[i] === candidate ? 'candidate' : 'interviewer',
  }));
}
