import { decodeFeedEntities } from '../connectors/feedText';
import { attrValue, findElement, findElements, htmlToText } from '../vacancies/ownVacancy/htmlScan';

/**
 * Текст чужой страницы для SMM-агента: статья или блог, пост Telegram-канала. Без DOM и без выполнения скриптов — тем же линейным разбором,
 * что читает страницы вакансий (htmlScan).
 */
export interface PageContent {
  readonly title: string | null;
  readonly author: string | null;
  readonly text: string;
}

/** Потолок текста примера: дальше в промпт он всё равно не войдёт. */
export const PAGE_TEXT_MAX_CHARS = 4_000;
/** Меньше — это не текст поста, а заглушка входа или пустая оболочка страницы. */
export const PAGE_TEXT_MIN_CHARS = 60;
/** Пост канала бывает в одну фразу — у них порог ниже, чем у статьи. */
const SHORT_POST_MIN_CHARS = 10;
const FIELD_MAX_CHARS = 200;
const JSON_LD_MAX = 500_000;
const WALL =
  /captcha|не\s+робот|not\s+a\s+robot|verify\s+you\s+are\s+human|are\s+you\s+a\s+robot|cf-challenge|access\s+denied|sign\s+in\s+to\s+(continue|view)|войдите,\s+чтобы/iu;

function field(value: string | null | undefined): string | null {
  if (!value) return null;
  const out = decodeFeedEntities(value).replace(/\s+/gu, ' ').trim();
  return out ? out.slice(0, FIELD_MAX_CHARS) : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function meta(html: string, key: string): string | null {
  const tag = findElement(html, 'meta', (attrs) =>
    [attrValue(attrs, 'property'), attrValue(attrs, 'name')].includes(key),
  );
  return field(tag ? attrValue(tag.attrs, 'content') : null);
}

const ARTICLE_TYPES = new Set([
  'Article',
  'NewsArticle',
  'BlogPosting',
  'SocialMediaPosting',
  'DiscussionForumPosting',
  'TechArticle',
]);

function isArticle(value: unknown): boolean {
  const type = record(value)['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === 'string' && ARTICLE_TYPES.has(t));
}

function jsonLdArticle(html: string): Record<string, unknown> | null {
  const blocks = findElements(html, 'script', (attrs) => /application\/ld\+json/iu.test(attrs));
  for (const { inner } of blocks) {
    if (inner.length > JSON_LD_MAX) continue;
    try {
      const parsed: unknown = JSON.parse(inner);
      const candidates = [
        parsed,
        ...(Array.isArray(parsed) ? parsed : []),
        ...[record(parsed)['@graph']].flat(),
      ];
      const found = candidates.find(isArticle);
      if (found) return record(found);
    } catch {
      continue;
    }
  }
  return null;
}

function ldAuthor(article: Record<string, unknown> | null): string | null {
  if (!article) return null;
  const first: unknown = Array.isArray(article.author) ? article.author[0] : article.author;
  return field(str(first) ?? str(record(first).name));
}

function cap(text: string): string {
  return text.length > PAGE_TEXT_MAX_CHARS ? `${text.slice(0, PAGE_TEXT_MAX_CHARS)}…` : text;
}

function bodyText(html: string, article: Record<string, unknown> | null): string {
  const fromLd = str(article?.articleBody);
  if (fromLd && fromLd.length >= PAGE_TEXT_MIN_CHARS) return htmlToText(fromLd);
  const scope =
    findElement(html, 'article') ?? findElement(html, 'main') ?? findElement(html, 'body');
  return htmlToText(scope?.inner ?? html);
}

/** Статья, блог, личный сайт: JSON-LD → <article> → <main> → <body>; иначе описание страницы. */
export function extractArticle(html: string): PageContent | null {
  const article = jsonLdArticle(html);
  const title =
    meta(html, 'og:title') ??
    field(str(article?.headline)) ??
    field(htmlToText(findElement(html, 'title')?.inner ?? ''));
  const metaAuthor = meta(html, 'author') ?? meta(html, 'article:author');
  const author =
    (metaAuthor && !/^https?:/iu.test(metaAuthor) ? metaAuthor : null) ??
    ldAuthor(article) ??
    meta(html, 'twitter:creator');
  const body = bodyText(html, article);
  // Только текст самой страницы: одно описание из метатегов — не прочитанная статья.
  const text = body;
  if (text.length < PAGE_TEXT_MIN_CHARS || (WALL.test(text) && text.length < 1_500)) return null;
  return { title, author, text: cap(text) };
}

/** Публичная лента t.me/s/<канал>/<номер>: блок с data-post="<канал>/<номер>". */
export function extractTelegramPost(
  html: string,
  channel: string,
  postId: string,
): PageContent | null {
  // Поиск без учета регистра по исходной строке: смещения из toLowerCase() могут разъехаться.
  const start = new RegExp(`data-post="${channel}/${postId}"`, 'iu').exec(html);
  if (!start) return null;
  const after = start.index + start[0].length;
  const next = html.slice(after).search(/data-post="/u);
  const scope = html.slice(start.index, next < 0 ? html.length : after + next);
  // Цитата ответа тоже несет класс tgme_widget_message_text: берем только сам текст поста.
  const body = findElement(scope, 'div', (attrs) => {
    const classes = (attrValue(attrs, 'class') ?? '').split(/\s+/u);
    return (
      classes.includes('tgme_widget_message_text') && !classes.includes('js-message_reply_text')
    );
  });
  const text = body ? htmlToText(body.inner) : '';
  if (text.length < SHORT_POST_MIN_CHARS) return null;
  const owner = findElement(scope, 'a', (attrs) =>
    /tgme_widget_message_owner_name/u.test(attrValue(attrs, 'class') ?? ''),
  );
  const author = field(owner ? htmlToText(owner.inner) : null) ?? meta(html, 'og:title');
  return { title: author ? `Пост канала ${author}` : null, author, text: cap(text) };
}
