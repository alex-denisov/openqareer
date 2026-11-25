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
