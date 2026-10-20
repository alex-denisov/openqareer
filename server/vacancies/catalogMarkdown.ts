/**
 * Описание вакансии в публичном каталоге: markdown площадки → безопасный HTML.
 *
 * Текст чужой и непроверенный, поэтому сначала экранируется целиком, и только
 * потом поверх экранированного текста ставятся наши теги. Так ни один символ
 * источника не может стать разметкой. Поддержан тот markdown, который реально
 * приходит из пула: заголовки, списки, жирный/курсив, код, ссылки.
 *
 * Часть источников дописывает в начало свою шапку (название, работодатель,
 * статус, «Top Skills») с эмодзи. Всё это страница уже показывает сама, а
 * эмодзи в продукте запрещены, поэтому шапка и эмодзи снимаются.
 */
import { escapeHtml } from './catalogHtml';

const ABOUT_ROLE = /^#{2,3}\s*About the Role\s*\n/u;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}|\u{200D}/gu;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/u;
const BULLET = /^\s*[-*•]\s+(.*)$/u;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/u;
const HEADING = /^\s*#{1,6}\s+(.*)$/u;

/**
 * The generated template (`renderVacancyTemplate.ts`) is `# Title` + meta,
 * then `---` + `### Top Skills`, then `---` + the real sections. Both leading
 * blocks repeat what the page prints itself.
 */
function dropPreamble(text: string): string {
  if (!text.startsWith('# ')) return text;
  const blocks = text.split(/\n\s*---\s*\n/u);
  let index = 1;
  if (blocks[index]?.trimStart().startsWith('### Top Skills')) index += 1;
  return blocks.slice(index).join('\n\n');
}

function clean(markdown: string): string {
  const text = dropPreamble(markdown.replace(/\r\n?/gu, '\n').trim());
  return text.trimStart().replace(ABOUT_ROLE, '').replace(EMOJI, '');
}

function safeHref(raw: string): string | null {
  return /^(https?:|mailto:)/iu.test(raw) ? raw : null;
}

/** Inline formatting on already-escaped text. */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (_match, label: string, href: string) => {
      const safe = safeHref(href);
      return safe ? `<a href="${safe}" rel="nofollow noopener">${label}</a>` : label;
    })
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/__([^_]+)__/gu, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/gu, '$1<em>$2</em>');
}

type Block =
  | { readonly kind: 'p'; readonly lines: readonly string[] }
  | { readonly kind: 'ul' | 'ol'; readonly items: readonly string[] }
  | { readonly kind: 'h'; readonly text: string };

function toBlocks(text: string): readonly Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'p', lines: paragraph });
    if (list) blocks.push(list);
    paragraph = [];
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = BULLET.exec(raw);
    const numbered = NUMBERED.exec(raw);
    const heading = HEADING.exec(raw);
    if (line === '' || RULE.test(line)) {
      // A blank line between list items keeps the list together.
      if (!list) flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: 'h', text: heading[1]!.trim() });
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (paragraph.length > 0 || (list && list.kind !== kind)) flush();
      list ??= { kind, items: [] };
      list.items.push((bullet ?? numbered)![1]!.trim());
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks.filter((block) => block.kind !== 'h' || block.text !== '');
}

export function renderDescriptionHtml(markdown: string): string {
  return toBlocks(clean(markdown))
    .map((block) => {
      if (block.kind === 'h') return `<h2>${inline(escapeHtml(block.text))}</h2>`;
      if (block.kind === 'p') return `<p>${inline(escapeHtml(block.lines.join(' ')))}</p>`;
      const items = block.items.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join('');
      return `<${block.kind}>${items}</${block.kind}>`;
    })
    .join('');
}

/** Plain one-line text for cards and meta descriptions. */
export function plainSummary(markdown: string, limit: number): string {
  const text = clean(markdown)
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[#*_`>]+/gu, '')
    .split('\n')
    .filter((line) => !RULE.test(line))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/u, '')}…`;
}

/**
 * Some sources send no description, and the pool fills the summary with
 * «Title — Place». Repeating the heading is not content: treat it as empty.
 */
export function meaningfulText(text: string, title: string): string {
  const norm = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const rest = norm(text).replace(norm(title), '');
  return rest.length < 40 ? '' : text;
}
