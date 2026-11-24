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

const SHORT_RECORDING_MS = 10 * 60_000;

/** «3 с», «1 мин 20 с», «2 мин»; от 10 минут — «58 минут». */
export function durationText(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}\u00a0с`;
  if (ms < SHORT_RECORDING_MS) {
    const rest = seconds % 60;
    const minutes = `${Math.floor(seconds / 60)}\u00a0мин`;
    return rest ? `${minutes} ${rest}\u00a0с` : minutes;
  }
  return pluralRu(Math.round(ms / 60_000), ['минута', 'минуты', 'минут']);
}

/** Строка под заголовком I4: «Арка Холдинг · интервью 12 ноября · с техническим директором». */
export function debriefLeadSub(input: {
  readonly company: string | undefined;
  readonly scheduledAt: string | null;
  readonly format: string | null;
  readonly interviewerName: string | null;
  readonly timeZone?: string;
}): string {
  const day =
    input.scheduledAt && !Number.isNaN(Date.parse(input.scheduledAt))
      ? new Intl.DateTimeFormat('ru-RU', {
          day: 'numeric',
          month: 'long',
          timeZone: input.timeZone,
        }).format(new Date(input.scheduledAt))
      : null;
  // Макет кончает строку собеседником; имя не склоняем, поэтому «собеседник: имя», без имени — формат.
  const name = input.interviewerName?.trim();
  const who = name ? `собеседник: ${name}` : input.format?.trim() || null;
  return [input.company?.trim() || null, day ? `интервью ${day}` : null, who]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
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
