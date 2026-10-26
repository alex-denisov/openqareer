export interface DescriptionSection {
  readonly title: string;
  readonly items: readonly string[];
  /** Which items were list lines in the source; the rest are paragraphs and subheadings. */
  readonly bullets: readonly boolean[];
}

export interface DescriptionSections {
  readonly intro: readonly string[];
  readonly sections: readonly DescriptionSection[];
}

const CANONICAL: readonly (readonly [RegExp, string])[] = [
  [
    /^(обязанности|задачи|чем (предстоит|вам предстоит|нужно) заниматься|что (нужно|предстоит) делать|responsibilities)/iu,
    'Чем предстоит заниматься',
  ],
  [
    /^(требования|что мы ждём|что мы ждем|мы ожидаем|ожидания|наши ожидания|requirements)/iu,
    'Что мы ждём',
  ],
  [/^(условия|мы предлагаем|что мы предлагаем|предлагаем|we offer)/iu, 'Условия'],
];

const BULLET = /^(?:[-*•–—·]|\d{1,2}[.)])\s+/u;
const MAX_HEADING_LENGTH = 48;

function headingOf(line: string): string | null {
  const bare = line.replace(/[:：]\s*$/u, '').trim();
  const canonical = CANONICAL.find(([pattern]) => pattern.test(bare));
  if (canonical && bare.length <= MAX_HEADING_LENGTH) return canonical[1];
  if (
    /[:：]\s*$/u.test(line) &&
    bare.length > 0 &&
    bare.length <= MAX_HEADING_LENGTH &&
    !BULLET.test(line)
  ) {
    return bare;
  }
  return null;
}

/** Splits a vacancy text into «Чем предстоит заниматься» / «Что мы ждём» /
 *  «Условия» by its own headings (B549). No headings → null, and the caller
 *  shows the text whole: sections are never invented. */
export function parseDescriptionSections(text: string): DescriptionSections | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const intro: string[] = [];
  const sections: { title: string; items: string[]; bullets: boolean[] }[] = [];
  for (const line of lines) {
    const heading = headingOf(line);
    if (heading) {
      sections.push({ title: heading, items: [], bullets: [] });
      continue;
    }
    const item = line.replace(BULLET, '');
    const current = sections.at(-1);
    if (current) {
      current.items.push(item);
      current.bullets.push(BULLET.test(line));
    } else intro.push(line);
  }
  const filled = sections.filter((section) => section.items.length > 0);
  if (filled.length === 0) return null;
  return { intro, sections: filled };
}
