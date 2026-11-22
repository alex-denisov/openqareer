import { pluralRu } from '../../../../../shared/pluralRu';
import type { DebriefLine, DebriefMetrics } from '../../../../../server/domain/interviewDebrief';

/** «04:12», после часа — «1:02:05». */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours > 0 ? `${hours}:${rest}` : rest;
}

export function durationText(ms: number): string {
  return pluralRu(Math.max(1, Math.round(ms / 60_000)), ['минута', 'минуты', 'минут']);
}

export interface ShareParts {
  readonly candidate: number | null;
  readonly interviewer: number | null;
  readonly tempo: number;
  readonly pauses: number;
}

export function shareParts(metrics: DebriefMetrics): ShareParts {
  return {
    candidate: metrics.candidateShare,
    interviewer: metrics.interviewerShare,
    tempo: metrics.wordsPerMinute,
    pauses: metrics.longPauses,
  };
}

function dayMonth(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(iso));
}

/** ⓘ «Откуда меры»: от какой записи, сколько минут, разделены ли голоса. */
export function measuresTip(startedAt: string, metrics: DebriefMetrics, voiced: boolean): string {
  const voices = voiced ? 'два голоса' : 'голоса не разделены';
  return `Считаем по расшифровке записи от ${dayMonth(startedAt)}, ${durationText(metrics.durationMs)}, ${voices}. Только слова, паузы и темп; настроение по голосу не оцениваем.`;
}

/** Кто говорит в строке расшифровки; у загруженного файла голосов нет — `null`. */
export function speakerLabel(
  speaker: DebriefLine['speaker'],
  interviewerName: string | null,
): string | null {
  if (speaker === 'candidate') return 'Вы';
  if (speaker === 'interviewer') return interviewerName?.trim() || 'Интервьюер';
  return null;
}
