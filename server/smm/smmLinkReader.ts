import { readVacancyPage, type PageReadResult } from '../vacancies/ownVacancy/pageReader';
import { extractArticle, extractTelegramPost, type PageContent } from './smmLinkExtract';
import { fetchThreadsPost, findThreadsUrl } from './smmThreadsLink';

/**
 * Любая ссылка владельца → настоящий текст страницы. Чтение идёт через тот же
 * читатель, что страницы вакансий (B676): только публичные адреса с проверкой
 * каждой переадресации, robots.txt, таймаут и потолок размера. Если страницу
 * прочитать нельзя, это честный отказ, а не догадка по адресу.
 */
export type LinkKind = 'threads' | 'telegram' | 'x' | 'linkedin' | 'page';

export type LinkRead =
  | { readonly ok: true; readonly kind: LinkKind; readonly url: string; readonly page: PageContent }
  | {
      readonly ok: false;
      readonly kind: LinkKind;
      readonly url: string;
      readonly reason: 'closed' | 'unreadable';
    };

export interface LinkReaderDeps {
  readonly readPage?: (url: string) => Promise<PageReadResult>;
  readonly fetchThreads?: (url: string) => Promise<string | null>;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'«»]+/iu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/u;
const TELEGRAM_HOST = /^(?:www\.)?(?:t\.me|telegram\.me)$/u;
const TELEGRAM_PATH = /^\/(?:s\/)?([a-z0-9_]{4,32})\/(\d{1,10})\/?$/iu;
const X_HOST = /^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)$/u;
const LINKEDIN_HOST = /(^|\.)linkedin\.com$/u;

/** Первая http(s)-ссылка в сообщении и текст вокруг неё (тема владельца). */
export function findLink(text: string): { url: string; rest: string } | null {
  const match = URL_IN_TEXT.exec(text);
  if (!match) return null;
  const raw = match[0].replace(TRAILING_PUNCTUATION, '');
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
      .replace(/\s+/gu, ' ')
      .trim();
    return { url: url.toString(), rest };
  } catch {
    return null;
  }
}

export function linkKind(url: URL): LinkKind {
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (findThreadsUrl(url.toString())) return 'threads';
  if (TELEGRAM_HOST.test(host)) return 'telegram';
  if (X_HOST.test(host)) return 'x';
  if (LINKEDIN_HOST.test(host)) return 'linkedin';
  return 'page';
}

function failure(kind: LinkKind, url: string, result: PageReadResult): LinkRead {
  const reason = !result.ok && result.reason === 'site_closed' ? 'closed' : 'unreadable';
  return { ok: false, kind, url, reason };
}

async function readTelegram(
  url: URL,
  readPage: NonNullable<LinkReaderDeps['readPage']>,
): Promise<LinkRead> {
  const match = TELEGRAM_PATH.exec(url.pathname);
  // t.me/c/… (закрытый канал) сюда не подходит: имя канала короче четырёх знаков.
  if (!match) {
    return { ok: false, kind: 'telegram', url: url.toString(), reason: 'unreadable' };
  }
  const [, channel, postId] = match as unknown as [string, string, string];
  const result = await readPage(`https://t.me/s/${channel}/${postId}`);
  const page = result.ok ? extractTelegramPost(result.html, channel, postId) : null;
  return page
    ? { ok: true, kind: 'telegram', url: url.toString(), page }
    : failure('telegram', url.toString(), result);
}

export async function readLink(link: string, deps: LinkReaderDeps = {}): Promise<LinkRead> {
  const readPage = deps.readPage ?? readVacancyPage;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { ok: false, kind: 'page', url: link, reason: 'unreadable' };
  }
  const kind = linkKind(url);
  if (kind === 'threads') {
    const text = await (deps.fetchThreads ?? fetchThreadsPost)(url.toString());
    return text
      ? { ok: true, kind, url: url.toString(), page: { title: null, author: null, text } }
      : { ok: false, kind, url: url.toString(), reason: 'unreadable' };
  }
  if (kind === 'telegram') return readTelegram(url, readPage);
  // X без входа отдает пустую оболочку, а его открытый oEmbed закрыт в robots.txt: не читаем.
  // LinkedIn закрыт условиями и robots.txt (B676): читатель откажет до запроса.
  if (kind === 'x') return { ok: false, kind, url: url.toString(), reason: 'closed' };
  const result = await readPage(url.toString());
  const page = result.ok ? extractArticle(result.html) : null;
  return page
    ? { ok: true, kind, url: url.toString(), page }
    : failure(kind, url.toString(), result);
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./u, '');
  } catch {
    return 'страницу';
  }
}

/** Одна строка владельцу: что не получилось и что прислать вместо ссылки. Никаких догадок о содержании. */
export function refusalText(read: Extract<LinkRead, { ok: false }>): string {
  if (read.kind === 'linkedin')
    return 'Посты LinkedIn я не открываю, поэтому текст не видел. Пришлите снимок экрана поста.';
  if (read.kind === 'threads')
    return 'Threads не отдал текст по ссылке (пост закрыт или удален). Пришлите снимок экрана.';
  if (read.kind === 'x')
    return 'Посты X без входа не открываются, поэтому текст я не видел. Пришлите снимок экрана поста.';
  if (read.kind === 'telegram')
    return 'Не нашел этот пост в открытой ленте канала, текст я не видел. Пришлите снимок экрана.';
  if (read.reason === 'closed')
    return `Сайт ${hostOf(read.url)} закрыт для чтения, текст я не видел. Пришлите снимок экрана.`;
  return `Не смог прочитать ${hostOf(read.url)}, текст я не видел. Пришлите снимок экрана.`;
}
