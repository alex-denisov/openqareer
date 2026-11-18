import { decodeFeedEntities } from '../../connectors/feedText';

/**
 * B676: линейный разбор чужой страницы. Регулярные выражения вида `<x>[\s\S]*?</x>` на
 * незакрытых тегах дают квадратичное время, и страница в 1,5 МБ держала бы цикл событий;
 * здесь каждый символ просматривается ограниченное число раз (indexOf вперёд, без возвратов).
 */
const SKIPPED = new Set(['script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript', 'template', 'svg', 'form', 'iframe']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'table', 'tr', 'main']);
const ATTR_MAX = 4_000;

/** Следующая `>` после `from`; одна позиция переиспользуется, пока не пройдена, — без повторного сканирования хвоста. */
function nextGt(text: string): (from: number) => number {
  let cached = -2;
  return (from) => {
    if (cached === -1) return -1;
    if (cached < from) cached = text.indexOf('>', from);
    return cached;
  };
}

/** Последняя `<` перед позицией; позиции спрашиваются по возрастанию, поэтому проход один. */
function lastLtTracker(text: string): (before: number) => number {
  let last = -1;
  let next = text.indexOf('<');
  return (before) => {
    while (next >= 0 && next < before) {
      last = next;
      next = text.indexOf('<', next + 1);
    }
    return last;
  };
}

function tagName(tag: string): string {
  let end = tag.startsWith('/') ? 1 : 0;
  const start = end;
  while (end < tag.length && /[a-z0-9]/iu.test(tag[end]!)) end += 1;
  return tag.slice(start, end).toLowerCase();
}

/** Конец закрывающего тега `</name>` начиная с `from`, или -1. `lower` — тот же текст в нижнем регистре. */
function closeEnd(lower: string, name: string, from: number): number {
  const at = lower.indexOf(`</${name}`, from);
  if (at < 0) return -1;
  const gt = lower.indexOf('>', at);
  return gt < 0 ? -1 : gt + 1;
}

function breakFor(name: string, closing: boolean): string {
  if (name === 'br') return '\n';
  if (name === 'li') return closing ? '' : '\n- ';
  return BLOCK.has(name) ? '\n\n' : ' ';
}

/** Один проход: текст без разметки, со структурой абзацев и пунктов; служебные блоки пропускаются. */
function stripOnce(html: string, skip: ReadonlySet<string>): string {
  const lower = html.toLowerCase();
  const gtFrom = nextGt(html);
  const out: string[] = [];
  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt < 0) { out.push(html.slice(index)); break; }
    out.push(html.slice(index, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end < 0) break;
      index = end + 3;
      continue;
    }
    const gt = gtFrom(lt);
    if (gt < 0) { out.push(html.slice(lt + 1)); break; }
    if (gt - lt > ATTR_MAX) { out.push(' '); index = lt + 1; continue; }
    const tag = html.slice(lt + 1, gt);
    const name = tagName(tag);
    const closing = tag.startsWith('/');
    if (!closing && skip.has(name) && !tag.endsWith('/')) {
      const end = closeEnd(lower, name, gt + 1);
      if (end < 0) break;
      index = end;
      continue;
    }
    out.push(name ? breakFor(name, closing) : ' ');
    index = gt + 1;
  }
  return out.join('');
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t\u00a0]+/gu, ' ')
    .replace(/ ?\n ?/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** HTML → текст. Описание JSON-LD бывает экранировано дважды (`&lt;p&gt;`): второй проход снимает его. */
export function htmlToText(html: string, skip: ReadonlySet<string> = SKIPPED): string {
  let text = html;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decodeFeedEntities(stripOnce(text, skip));
    if (next === text) break;
    text = next;
  }
  return tidy(text);
}

export interface Element {
  readonly attrs: string;
  readonly inner: string;
}

/** Первый элемент `name`, у открывающего тега которого `test(attrs)`; содержимое — до первого `</name>`. */
export function findElement(html: string, name: string, test: (attrs: string) => boolean = () => true, from = 0): Element | null {
  const lower = html.toLowerCase();
  const gtFrom = nextGt(lower);
  let index = from;
  for (;;) {
    const at = lower.indexOf(`<${name}`, index);
    if (at < 0) return null;
    const gt = gtFrom(at);
    if (gt < 0) return null;
    const after = lower[at + name.length + 1] ?? '';
    if (/[\s>/]/u.test(after) && gt - at <= ATTR_MAX && test(html.slice(at + name.length + 1, gt))) {
      const attrs = html.slice(at + name.length + 1, gt);
      const end = lower.indexOf(`</${name}`, gt + 1);
      return { attrs, inner: html.slice(gt + 1, end < 0 ? html.length : end) };
    }
    index = gt + 1;
  }
}

/** Все элементы `name` подряд (для JSON-LD), не больше `limit`. */
export function findElements(html: string, name: string, test: (attrs: string) => boolean, limit = 20): Element[] {
  const out: Element[] = [];
  const lower = html.toLowerCase();
  const gtFrom = nextGt(lower);
  let index = 0;
  while (out.length < limit) {
    const at = lower.indexOf(`<${name}`, index);
    if (at < 0) break;
    const gt = gtFrom(at);
    if (gt < 0) break;
    const end = lower.indexOf(`</${name}`, gt + 1);
    const attrs = gt - at <= ATTR_MAX ? html.slice(at + name.length + 1, gt) : null;
    if (attrs !== null && test(attrs)) out.push({ attrs, inner: html.slice(gt + 1, end < 0 ? html.length : end) });
    if (end < 0) break;
    index = end + name.length + 2;
  }
  return out;
}

/** Значение атрибута из строки атрибутов открывающего тега. */
export function attrValue(attrs: string, name: string): string | null {
  const lower = attrs.toLowerCase();
  const at = lower.search(new RegExp(`(^|\\s)${name}\\s*=`, 'u'));
  if (at < 0) return null;
  const eq = attrs.indexOf('=', at);
  const rest = attrs.slice(eq + 1).trimStart();
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    const end = rest.indexOf(quote, 1);
    return end < 0 ? null : rest.slice(1, end);
  }
  return rest.split(/\s/u)[0] ?? null;
}

/** Элемент с атрибутом itemprop=name (любой тег), содержимое — до закрытия того же тега. */
export function findItemprop(html: string, prop: string): string | null {
  const lower = html.toLowerCase();
  const gtFrom = nextGt(lower);
  const lastLtBefore = lastLtTracker(lower);
  let index = 0;
  for (;;) {
    const at = lower.indexOf('itemprop=', index);
    if (at < 0) return null;
    const lt = lastLtBefore(at);
    const gt = gtFrom(at);
    if (gt < 0) return null;
    if (lt < 0 || gt - lt > ATTR_MAX) { index = at + 1; continue; }
    const attrs = html.slice(lt, gt);
    if (attrValue(attrs.replace(/^<[a-z0-9]+/iu, ' '), 'itemprop') === prop) {
      const name = tagName(html.slice(lt + 1, gt));
      const end = lower.indexOf(`</${name}`, gt + 1);
      return html.slice(gt + 1, end < 0 ? html.length : end);
    }
    index = gt + 1;
  }
}
