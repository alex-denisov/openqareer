/**
 * B751: разбор после интервью по расшифровке записи. Метрики считаются кодом (слова,
 * паузы, темп), модель только находит вопросы и договорённости. «Было готово» и «Что
 * договорились» принимаются лишь с цитатой, которая дословно есть в расшифровке.
 */

/** Строка расшифровки: `null` — загруженный файл, голоса не разделены. */
export interface DebriefLine {
  readonly speaker: 'candidate' | 'interviewer' | null;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface DebriefMetrics {
  readonly durationMs: number;
  /** Доля речи в процентах; `null`, когда голоса не разделены. */
  readonly candidateShare: number | null;
  readonly interviewerShare: number | null;
  /** Слова в минуту: у кандидата, а без голосов — по всей речи. */
  readonly wordsPerMinute: number;
  readonly longPauses: number;
}

export interface DebriefQuestion {
  readonly atMs: number;
  readonly question: string;
  readonly summary: string;
  readonly prepared: boolean;
  readonly quote: string | null;
  readonly fix: string | null;
}

export interface DebriefAgreement {
  readonly atMs: number;
  readonly text: string;
  readonly quote: string;
}

export interface DebriefFindings {
  readonly questions: readonly DebriefQuestion[];
  readonly agreements: readonly DebriefAgreement[];
  /** «К следующей встрече»: что поправить там, где ответа не было. */
  readonly nextPrep: readonly string[];
}

export const LONG_PAUSE_MS = 3_000;
/** Около 20 тыс. токенов: длинное интервью урезается с конца. */
export const DEBRIEF_INPUT_CHARS = 60_000;
const MAX_QUESTIONS = 20;
const MAX_AGREEMENTS = 10;
const MAX_TEXT = 300;

const spoken = (line: DebriefLine) => Math.max(0, line.endMs - line.startMs);
const words = (text: string) =>
  text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function countLongPauses(lines: readonly DebriefLine[]): number {
  const ordered = [...lines].sort((a, b) => a.startMs - b.startMs);
  return ordered.slice(1).filter((line, index) => {
    const previous = ordered[index];
    return previous !== undefined && line.startMs - previous.endMs > LONG_PAUSE_MS;
  }).length;
}

export function debriefMetrics(lines: readonly DebriefLine[]): DebriefMetrics {
  if (lines.length === 0) {
    return {
      durationMs: 0,
      candidateShare: null,
      interviewerShare: null,
      wordsPerMinute: 0,
      longPauses: 0,
    };
  }
  const start = Math.min(...lines.map((line) => line.startMs));
  const end = Math.max(...lines.map((line) => line.endMs));
  const voiced = lines.some((line) => line.speaker !== null);
  const candidate = lines.filter((line) => line.speaker === 'candidate');
  const interviewer = lines.filter((line) => line.speaker === 'interviewer');
  const candidateMs = candidate.reduce((sum, line) => sum + spoken(line), 0);
  const interviewerMs = interviewer.reduce((sum, line) => sum + spoken(line), 0);
  const tempoLines = voiced ? candidate : lines;
  const tempoMs = tempoLines.reduce((sum, line) => sum + spoken(line), 0);
  const tempoWords = tempoLines.reduce((sum, line) => sum + words(line.text), 0);
  return {
    durationMs: end - start,
    candidateShare: voiced ? share(candidateMs, candidateMs + interviewerMs) : null,
    interviewerShare: voiced ? share(interviewerMs, candidateMs + interviewerMs) : null,
    wordsPerMinute: tempoMs > 0 ? Math.round(tempoWords / (tempoMs / 60_000)) : 0,
    longPauses: countLongPauses(lines),
  };
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours > 0 ? `${hours}:${rest}` : rest;
}

const SPEAKER: Readonly<Record<string, string>> = {
  candidate: 'Кандидат',
  interviewer: 'Интервьюер',
};

/** Вход модели: «[мм:сс] Кто: текст» построчно, не длиннее `limit` знаков. */
export function debriefTranscriptText(
  lines: readonly DebriefLine[],
  limit = DEBRIEF_INPUT_CHARS,
): string {
  let text = '';
  for (const line of lines) {
    const who = line.speaker ? `${SPEAKER[line.speaker]}: ` : '';
    const row = `[${clock(line.startMs)}] ${who}${line.text.trim()}`;
    const next = text ? `${text}\n${row}` : row;
    if (next.length > limit) break;
    text = next;
  }
  return text;
}

const normalize = (text: string) =>
  text
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function quoteIn(quote: unknown, corpus: string): string | null {
  if (typeof quote !== 'string') return null;
  const needle = normalize(quote);
  return needle.length >= 8 && corpus.includes(needle) ? quote.trim().slice(0, MAX_TEXT) : null;
}

/** Время вопроса — начало ближайшей настоящей строки, а не число модели. */
function snap(atMs: unknown, lines: readonly DebriefLine[]): number {
  const at = typeof atMs === 'number' && Number.isFinite(atMs) ? atMs : 0;
  return lines.reduce(
    (best, line) => (Math.abs(line.startMs - at) < Math.abs(best - at) ? line.startMs : best),
    lines[0]?.startMs ?? 0,
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '');
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function acceptQuestion(
  raw: unknown,
  lines: readonly DebriefLine[],
  corpus: string,
): DebriefQuestion | null {
  const item = record(raw);
  const question = text(item?.question);
  if (!item || !question) return null;
  const quote = item.prepared === true ? quoteIn(item.quote, corpus) : null;
  return {
    atMs: snap(item.atMs, lines),
    question,
    summary: text(item.summary),
    prepared: quote !== null,
    quote,
    fix: text(item.fix) || null,
  };
}

function acceptAgreement(
  raw: unknown,
  lines: readonly DebriefLine[],
  corpus: string,
): DebriefAgreement | null {
  const item = record(raw);
  const quote = quoteIn(item?.quote, corpus);
  const body = text(item?.text);
  return item && quote && body ? { atMs: snap(item.atMs, lines), text: body, quote } : null;
}

export function acceptDebrief(raw: unknown, lines: readonly DebriefLine[]): DebriefFindings | null {
  const body = record(raw);
  if (!body || !Array.isArray(body.questions) || !Array.isArray(body.agreements ?? [])) return null;
  const corpus = normalize(lines.map((line) => line.text).join(' '));
  const questions = body.questions
    .slice(0, MAX_QUESTIONS)
    .map((item) => acceptQuestion(item, lines, corpus))
    .filter((item): item is DebriefQuestion => item !== null);
  const agreements = ((body.agreements as unknown[] | undefined) ?? [])
    .slice(0, MAX_AGREEMENTS)
    .map((item) => acceptAgreement(item, lines, corpus))
    .filter((item): item is DebriefAgreement => item !== null);
  const nextPrep = questions
    .filter((item) => !item.prepared && item.fix)
    .map((item) => item.fix as string);
  return { questions, agreements, nextPrep };
}
