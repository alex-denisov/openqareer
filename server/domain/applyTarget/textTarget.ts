import { atsAddress, isEmployerChannel, type ApplyAddress } from './applyAddress';

/** Адрес отклика, названный в тексте вакансии. Два разных адреса — неясно какой, значит никакой. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/giu;
const EMAIL_IN_TEXT = /[\p{L}\p{N}._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/giu;
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

const trim = (url: string) => url.replace(/&amp;/gu, '&').replace(/[.,;:!?]+$/u, '');

function decoded(text: string): string {
  return text.replace(/&#x2F;/giu, '/').replace(/<a\s[^>]*href="([^"]+)"[^>]*>.*?<\/a>/giu, ' $1 ');
}

/** Единственная вакансия на ATS работодателя, названная в тексте. */
export function atsInText(text: string): ApplyAddress | null {
  const found = new Map<string, ApplyAddress>();
  for (const [raw] of decoded(text).matchAll(URL_IN_TEXT)) {
    const target = atsAddress(trim(raw));
    if (target && isEmployerChannel(target.channel)) found.set(target.url.toLowerCase(), target);
  }
  return found.size === 1 ? [...found.values()][0]! : null;
}

function before(text: string, index: number): string {
  return text.slice(Math.max(0, index - CUE_WINDOW), index);
}

/** Единственная почта, на которую прямо просят прислать отклик. */
export function emailInText(text: string): string | null {
  const found = new Set<string>();
  for (const match of text.matchAll(EMAIL_IN_TEXT)) {
    const email = match[0].replace(/\.$/u, '').toLowerCase();
    const context = before(text, match.index);
    const sentence = context.split(/[.!?]\s|\n{2,}/u).at(-1) ?? '';
    const after = text.slice(match.index, match.index + CUE_WINDOW / 2);
    if (
      !NOT_APPLY.test(email) &&
      !NOT_APPLY.test(sentence) &&
      !NOT_APPLY.test(after) &&
      APPLY_CUE.test(sentence.trimEnd() + ' ')
    )
      found.add(email);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Единственный контакт Telegram, которому просят написать. */
export function telegramInText(text: string): string | null {
  const found = new Set<string>();
  for (const match of text.matchAll(TELEGRAM_HANDLE)) {
    const previous = text[match.index - 1] ?? ' ';
    if (/[\p{L}\p{N}._%+-]/u.test(previous)) continue;
    if (MESSAGE_CUE.test(before(text, match.index))) found.add(match[1]!.toLowerCase());
  }
  return found.size === 1 ? `https://t.me/${[...found][0]}` : null;
}
