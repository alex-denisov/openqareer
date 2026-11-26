import { decodeHtmlText } from './hhMarkup';
import { hhQaBlocks } from './hhResumeCards';
import { HH_MONTH_NAMES as MONTHS } from './hhMonths';

/**
 * B787: когда страница резюме hh.ru прочиталась без мест работы, .app кладёт рядом с
 * connector.log набросок разметки блока «Опыт работы»: теги и `data-qa` как есть, в тексте
 * буквы заменены на `x`, цифры и знаки сохранены, названия месяцев — токены `MON_01`…`MON_12`.
 * Личного текста в наброске нет; файл локальный и никуда не отправляется.
 */
export const HH_MARKUP_SKETCH_MAX_LENGTH = 16_000;
const CARDS_MAX = 2;
const TEXT_MAX = 80;
const PERIOD_LINES_MAX = 20;

const MONTH_TOKEN: ReadonlyMap<string, string> = new Map(
  MONTHS.flatMap((names, index) =>
    names.map((name) => [name, `MON_${String(index + 1).padStart(2, '0')}`] as const),
  ),
);

/** Слово-месяц — токен, остальные буквы — `x`, всё не-ASCII — `?`. */
export function maskResumeText(text: string): string {
  return text
    .replace(/\p{L}+/gu, (word) => MONTH_TOKEN.get(word.toLowerCase()) ?? 'x'.repeat(word.length))
    .replace(/[^\x20-\x7e]/gu, '?');
}

const TAG = /<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/giu;
const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr', 'source', 'col', 'area']);
const qaOf = (attributes: string) => /data-qa=["']([^"']*)["']/iu.exec(attributes)?.[1] ?? '';
const safeQa = (qa: string) => qa.replace(/[^A-Za-z0-9_ -]/gu, '?').slice(0, 120);

function textLine(raw: string, depth: number): string | null {
  const text = decodeHtmlText(raw).replace(/\s+/gu, ' ').trim();
  return text ? `${'  '.repeat(depth)}"${maskResumeText(text).slice(0, TEXT_MAX)}"` : null;
}

/** Дерево элемента строками: `tag[data-qa]` с отступом, текст — замаскированной строкой. */
function tree(html: string): string[] {
  const lines: string[] = [];
  let depth = 0;
  let last = 0;
  for (const match of html.matchAll(TAG)) {
    const text = textLine(html.slice(last, match.index), depth);
    if (text) lines.push(text);
    last = match.index + match[0].length;
    const [, slash, name = '', attributes = ''] = match;
    const tag = name.toLowerCase();
    if (slash) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const qa = qaOf(attributes);
    lines.push(`${'  '.repeat(depth)}${tag}${qa ? `[${safeQa(qa)}]` : ''}`);
    if (!VOID.has(tag) && !attributes.endsWith('/')) depth += 1;
  }
  return lines;
}

function periodLines(html: string): string[] {
  const text = decodeHtmlText(html.replace(TAG, '\n'));
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => /\d{4}/u.test(line))
    .slice(0, PERIOD_LINES_MAX)
    .map((line) => maskResumeText(line).slice(0, TEXT_MAX));
}

/** Набросок для файла диагностики; ограничен по длине и состоит только из ASCII. */
export function hhResumeMarkupSketch(page: string): string {
  const html = page.replace(/<!--[\s\S]*?-->/gu, '');
  const cards = hhQaBlocks(html, 'profile-experience-company-card').slice(0, CARDS_MAX);
  const block =
    cards.length > 0 ? cards : hhQaBlocks(html, 'resume-list-card-experience').slice(0, 1);
  const experienceQa = [
    ...new Set(
      [...html.matchAll(/data-qa=["']([^"']*experience[^"']*)["']/giu)].map((m) =>
        safeQa(m[1] ?? ''),
      ),
    ),
  ];
  const sections = [
    `cards ${hhQaBlocks(html, 'profile-experience-company-card').length}`,
    `experience_qa ${experienceQa.slice(0, 40).join(',') || '-'}`,
    '--- periods',
    ...block.flatMap(periodLines),
    '--- markup',
    ...block.flatMap((element, index) => [...(index > 0 ? ['---'] : []), ...tree(element)]),
  ];
  return sections.join('\n').slice(0, HH_MARKUP_SKETCH_MAX_LENGTH);
}
