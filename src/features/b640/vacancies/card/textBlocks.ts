export interface TextBlock {
  readonly kind: 'h' | 'p';
  readonly text: string;
}

const HEADING_LIMIT = 60;

function headingText(line: string): string | null {
  const marked = /^(?:#{1,4}\s+|\*\*)(.+?)(?:\*\*)?:?$/u.exec(line);
  if (marked) return marked[1]!.trim();
  if (line.length <= HEADING_LIMIT && line.endsWith(':')) return line.slice(0, -1).trim();
  return null;
}

/** Текст вакансии строками: подзаголовок или абзац. */
export function textBlocks(description: string): readonly TextBlock[] {
  return description
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): TextBlock => {
      const heading = headingText(line);
      return heading ? { kind: 'h', text: heading } : { kind: 'p', text: line };
    });
}

/** «hh.ru · опубликована 11 ноября»; для другого года — с годом. */
export function publishedLine(source: string, observedAt: string, now: Date = new Date()): string {
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return source;
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  const text = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'Europe/Moscow',
  })
    .format(date)
    .replace(/\s*г\.$/u, '');
  return `${source} · опубликована ${text}`;
}
