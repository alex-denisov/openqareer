import { atsAddress, isEmployerChannel, type ApplyAddress } from './applyAddress';

/** Адрес отклика, названный в тексте вакансии. Два разных адреса — неясно какой, значит никакой. */
const URL_START = /https?:\/\//giu;
const URL_END = /[\s<>"'`)\]]/u;
const TELEGRAM_HANDLE = /(?:https:\/\/t\.me\/|@)([a-z][a-z0-9_]{4,31})(?![\w/.])/giu;

/** Просьба прислать отклик рядом с адресом. */
const APPLY_CUE =
  /(?:e-?mail|send|submit|forward)[^.!?\n]{0,80}(?:resume|cv\b|cover letter|application|about yourself)|(?:apply|resume|cv)[^.!?\n]{0,40}(?:to|at|via)\s*:?\s*$|(?:присыла|пришл|отправ|направ|шлите|откли)[^.!?\n]{0,80}$|(?:резюме|cv)[^.!?\n]{0,40}$/iu;
const MESSAGE_CUE =
  /(?:пиши|пишите|писать|откли|резюме|контакт|связ|contact|apply|dm|write|message|telegram|cv)[^.!?\n]{0,60}$/iu;
/** Почта не для отклика: особые условия, согласие, мошенники, справка. */
const NOT_APPLY =
  /accommodat|disabil|accessib|privacy|fraud|scam|complain|legal|support|noreply|no-reply|unsubscribe|gdpr|talentdata/iu;
const CUE_WINDOW = 160;

/** Текст чужой и без предела: длинный разбирается с обоих концов, контакт отклика обычно в конце. */
const TEXT_EDGE = 20_000;
const URL_MAX_LENGTH = 1024;
/** Больше ссылок или адресов — сборник, одной цели в нём нет. */
const MAX_FOUND = 40;
/** Столько «@» в тексте одной вакансии не бывает. */
const MAX_AT_SIGNS = 400;
const LOCAL_MAX_LENGTH = 64;
const DOMAIN_MAX_LENGTH = 253;
const LOCAL = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/u;
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u;
const LOCAL_CHAR = /[a-z0-9._+-]/iu;
const DOMAIN_CHAR = /[a-z0-9.-]/iu;
/** Что вправе стоять перед почтой: иначе это обрывок адреса с `%`, чужой буквой и подобным. */
const BEFORE_EMAIL = /[\s(<[{"'«:,;|=>•–—*]/u;

function bounded(text: string): string {
  return text.length <= TEXT_EDGE * 2
    ? text
    : `${text.slice(0, TEXT_EDGE)}\n${text.slice(-TEXT_EDGE)}`;
}

function trim(url: string): string {
  const value = url.replace(/&amp;/gu, '&');
  let end = value.length;
  while (end > 0 && '.,;:!?'.includes(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

/** Адрес ссылки вместо её тега и подписи: подпись бывает тем же адресом с обрывом «…». */
function withoutAnchors(text: string): string {
  const lower = text.toLowerCase();
  const pieces: string[] = [];
  let from = 0;
  for (;;) {
    const open = lower.indexOf('<a ', from);
    const close = open < 0 ? -1 : lower.indexOf('</a>', open);
    if (close < 0) break;
    const href = /href="([^"]{1,1024})"/iu.exec(
      text.slice(open, Math.min(close, open + URL_MAX_LENGTH * 2)),
    );
    pieces.push(text.slice(from, open), href ? ` ${href[1]} ` : text.slice(open, close));
    from = close + '</a>'.length;
  }
  return [...pieces, text.slice(from)].join('');
}

/** Ссылки текста; `null` — их столько, что это не одна вакансия. */
function urlsIn(text: string): readonly string[] | null {
  const urls: string[] = [];
  let next = 0;
  for (const { index } of text.matchAll(URL_START)) {
    if (index < next) continue;
    if (urls.length >= MAX_FOUND) return null;
    const tail = text.slice(index, index + URL_MAX_LENGTH + 1);
    const end = tail.search(URL_END);
    const url = end < 0 ? tail : tail.slice(0, end);
    next = index + url.length;
    if (url.length <= URL_MAX_LENGTH) urls.push(trim(url));
  }
  return urls;
}

/** Единственная вакансия на ATS работодателя, названная в тексте. */
export function atsInText(text: string): ApplyAddress | null {
  const found = new Map<string, ApplyAddress>();
  for (const url of urlsIn(withoutAnchors(bounded(text).replace(/&#x2F;/giu, '/'))) ?? []) {
    const target = atsAddress(url);
    if (target && isEmployerChannel(target.channel)) found.set(target.url.toLowerCase(), target);
    if (found.size > 1) return null;
  }
  return [...found.values()][0] ?? null;
}

function before(text: string, index: number): string {
  return text.slice(Math.max(0, index - CUE_WINDOW), index);
}

interface FoundEmail {
  readonly email: string;
  readonly index: number;
}

/** Почта вокруг `@`: части ограничены, поэтому разбор линейный. */
function emailAt(text: string, at: number): FoundEmail | null {
  let start = at;
  while (start > 0 && at - start <= LOCAL_MAX_LENGTH && LOCAL_CHAR.test(text[start - 1]!))
    start -= 1;
  let end = at + 1;
  while (end < text.length && end - at <= DOMAIN_MAX_LENGTH + 1 && DOMAIN_CHAR.test(text[end]!))
    end += 1;
  if (start > 0 && !BEFORE_EMAIL.test(text[start - 1]!)) return null;
  const local = text.slice(start, at).toLowerCase();
  let domain = text.slice(at + 1, end).toLowerCase();
  while (domain.endsWith('.')) domain = domain.slice(0, -1);
  if (local.length > LOCAL_MAX_LENGTH || domain.length > DOMAIN_MAX_LENGTH) return null;
  return LOCAL.test(local) && DOMAIN.test(domain)
    ? { email: `${local}@${domain}`, index: start }
    : null;
}

/** Единственная почта, на которую прямо просят прислать отклик. */
export function emailInText(raw: string): string | null {
  const text = bounded(raw);
  const found = new Set<string>();
  let seen = 0;
  let signs = 0;
  for (let at = text.indexOf('@'); at >= 0; at = text.indexOf('@', at + 1)) {
    signs += 1;
    if (signs > MAX_AT_SIGNS) return null;
    const match = emailAt(text, at);
    if (!match) continue;
    seen += 1;
    if (seen > MAX_FOUND) return null;
    const sentence =
      before(text, match.index)
        .split(/[.!?]\s|\n{2,}/u)
        .at(-1) ?? '';
    const after = text.slice(match.index, match.index + CUE_WINDOW / 2);
    const other = [match.email, sentence, after].some((part) => NOT_APPLY.test(part));
    if (!other && APPLY_CUE.test(`${sentence.trimEnd()} `)) found.add(match.email);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Ссылка письма: ни один знак адреса не меняет получателя и полей письма. */
export function mailtoOf(email: string): string {
  const at = email.lastIndexOf('@');
  return `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}`;
}

/** Единственный контакт Telegram, которому просят написать. */
export function telegramInText(raw: string): string | null {
  const text = bounded(raw);
  let seen = 0;
  const found = new Set<string>();
  for (const match of text.matchAll(TELEGRAM_HANDLE)) {
    seen += 1;
    if (seen > MAX_FOUND) return null;
    const previous = text[match.index - 1] ?? ' ';
    if (/[\p{L}\p{N}._%+-]/u.test(previous)) continue;
    if (MESSAGE_CUE.test(before(text, match.index))) found.add(match[1]!.toLowerCase());
  }
  return found.size === 1 ? `https://t.me/${[...found][0]}` : null;
}
