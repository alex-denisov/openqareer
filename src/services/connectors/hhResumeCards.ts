import type { ParsedResumeExperience } from '../../features/workspace/resumeParser';
import { decodeHtmlText } from './hhMarkup';

/**
 * Карточки страницы `hh.ru/resume/<id>` (разметка 25.11.2026): опыт — по компаниям, внутри
 * ступени должностей; «О себе» — своя карточка. Подписи зависят от языка аккаунта, поэтому
 * разделы узнаются по `data-qa`, а срок — по виду «месяц год — месяц год».
 */
const VOID_TAGS: ReadonlySet<string> = new Set([
  'br',
  'hr',
  'img',
  'input',
  'wbr',
  'source',
  'col',
  'area',
]);
const INLINE_TAGS: ReadonlySet<string> = new Set([
  'a',
  'b',
  'i',
  'em',
  'strong',
  'span',
  'u',
  'mark',
  'small',
  'wbr',
]);
const TAG = /<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/giu;

/** Содержимое элементов, открывающий тег которых подходит; вложенные в найденный не ищутся. */
function elements(html: string, matches: (tag: string, attributes: string) => boolean) {
  const found: Array<{ readonly start: number; readonly end: number; readonly inner: string }> = [];
  const open: string[] = [];
  let begin: { readonly depth: number; readonly start: number; readonly inner: number } | null =
    null;
  for (const match of html.matchAll(TAG)) {
    const [whole, slash, name = '', attributes = ''] = match;
    const tag = name.toLowerCase();
    if (VOID_TAGS.has(tag) || attributes.endsWith('/')) continue;
    if (!slash) {
      if (!begin && matches(tag, attributes)) {
        begin = { depth: open.length, start: match.index, inner: match.index + whole.length };
      }
      open.push(tag);
      continue;
    }
    const depth = open.lastIndexOf(tag);
    if (depth < 0) continue;
    open.length = depth;
    if (begin && depth === begin.depth) {
      found.push({
        start: begin.start,
        end: match.index + whole.length,
        inner: html.slice(begin.inner, match.index),
      });
      begin = null;
    }
  }
  return found;
}

const qaOf = (attributes: string) =>
  /data-qa=["']([^"']*)["']/iu.exec(attributes)?.[1]?.split(/\s+/u) ?? [];

function byQa(html: string, qa: string): string[] {
  return elements(html, (_tag, attributes) => qaOf(attributes).includes(qa)).map(
    (element) => element.inner,
  );
}

function without(html: string, matches: (tag: string, attributes: string) => boolean): string {
  return elements(html, matches).reduceRight(
    (rest, { start, end }) => `${rest.slice(0, start)}\n${rest.slice(end)}`,
    html,
  );
}

/** Видимый текст строками; кнопки («Развернуть», правка) — не текст резюме. */
function textLines(html: string): string[] {
  const text = without(html, (tag) => tag === 'button' || tag === 'svg').replace(
    TAG,
    (_whole, _slash, name: string, attributes: string) =>
      INLINE_TAGS.has(name.toLowerCase()) && !qaOf(attributes).includes('cell-text-content')
        ? ' '
        : '\n',
  );
  return decodeHtmlText(text)
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

const PERIOD =
  /(\p{L}+\s+\d{4})\s*[—–-]\s*(?:(\p{L}+\s+\d{4})|(?:по\s+)?(?:настоящее время|сейчас)|present|now|currently|till now|to date)(?:\s*\([^)]*\))?/iu;

/** Ступень без срока — не место работы: должность и текст в ней не различить. */
function placeOf(step: string, employer: string): ParsedResumeExperience[] {
  const text = textLines(step).join('\n');
  const period = PERIOD.exec(text);
  const title = period ? text.slice(0, period.index).replace(/\s+/gu, ' ').trim() : '';
  if (!period || !title) return [];
  const description = text.slice(period.index + period[0].length).trim();
  return [
    {
      title,
      employer,
      startDate: period[1],
      endDate: period[2],
      current: period[2] === undefined,
      responsibilities: description ? [description] : [],
      achievements: [],
    },
  ];
}

export function hhResumeExperienceCards(html: string): ParsedResumeExperience[] {
  return byQa(html, 'profile-experience-company-card').flatMap((card) => {
    const employer = textLines(byQa(card, 'cell-left-side')[0] ?? '')[0];
    if (!employer) return [];
    return byQa(card, 'magritte-stepper-step').flatMap((step) =>
      placeOf(byQa(step, 'magritte-stepper-step-content')[0] ?? step, employer),
    );
  });
}

const ABOUT_HEADING = /^(?:о себе|обо мне|about(?: me| myself)?)$/iu;

/** `undefined` — карточки «О себе» на странице нет: раздел не прочитан. */
export function hhResumeAboutCard(html: string): string | undefined {
  const card = byQa(html, 'resume-about-card')[0];
  if (card === undefined) return undefined;
  const body = without(
    card,
    (tag, attributes) => /^h\d$/u.test(tag) || qaOf(attributes).includes('title-container'),
  );
  return textLines(body)
    .filter((line, index) => index > 0 || !ABOUT_HEADING.test(line))
    .join('\n');
}
