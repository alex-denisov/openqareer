import type { ResumeLang } from '../../shared/resumeVacancyEdits';
import { checkedBullet } from './experienceFactRewrite';
import { addsPersonalAction, type LetterFactTranslator } from './letterFactTranslation';
import { transliterate } from './letterLatinEmployers';
import { textLanguage } from './profileLanguage';
import type { ResumeDocument, ResumeExperience, ResumeProject } from './resumeStudioTypes';
import { keepsSourceNumbers } from './resumeVacancyEdits';

/**
 * B785, o03: резюме под вакансию на другом языке. Строки переводит тот же переводчик, что пункты «Опыта»,
 * и каждая проходит те же проверки: ни числа, ни личного действия сверх исходной строки. Имена людей,
 * компаний и вузов в модель не уходят: в английском резюме они транслитерируются. Строка, которую
 * проверка не пропустила дважды, в переведённое резюме не входит: ни выдумки, ни смеси языков.
 */
export type ResumeTranslations = Readonly<Record<string, string>>;

type Kind = 'text' | 'label';

interface Line {
  readonly kind: Kind;
  readonly text: string;
}

const CYRILLIC = /\p{Script=Cyrillic}/u;
const SEGMENT_MAX = 240;
const LABEL_MAX = 200;
const ATTEMPTS = 2;
const PARALLEL = 30;
/** Больше трети строк не прошло проверку: такое резюме не показываем. */
const MAX_DROPPED_SHARE = 1 / 3;

function needs({ kind, text }: Line, lang: ResumeLang): boolean {
  if (lang === 'en') return CYRILLIC.test(text);
  // Короткие латинские названия (Go, CTO) в русском резюме пишут так же.
  return kind === 'text' && !CYRILLIC.test(text) && textLanguage(text) === 'en';
}

export const translationKey = (lang: ResumeLang, text: string) => `${lang}:${text}`;

type Map1 = (text: string, kind: Kind) => string;
type Claim = { readonly value: string };

/** Пустой перевод — строки в этом языке нет. */
function claim<T extends Claim>(item: T | null | undefined, map: Map1, kind: Kind): T | null {
  if (!item) return null;
  const value = map(item.value, kind);
  return value ? { ...item, value } : null;
}

const named = (lang: ResumeLang) => (text: string) =>
  lang === 'en' && CYRILLIC.test(text) ? transliterate(text) : text;

const linesOf = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const mapLines = (text: string, map: Map1) =>
  linesOf(text)
    .map((line) => map(line, 'text'))
    .filter(Boolean)
    .join('\n');

function mapPlace(place: ResumeExperience, map: Map1, name: (text: string) => string) {
  const lines: Map1 = (text) => mapLines(text, map);
  return {
    ...place,
    title: claim(place.title, map, 'text'),
    employer: claim(place.employer, name, 'label'),
    location: claim(place.location, map, 'label'),
    ...(place.description ? { description: claim(place.description, lines, 'text') } : {}),
    bullets: place.bullets.flatMap((bullet) => claim(bullet, lines, 'text') ?? []),
  };
}

function mapProject(project: ResumeProject, map: Map1, name: (text: string) => string) {
  return {
    ...project,
    name: { ...project.name, value: name(project.name.value) },
    employer: claim(project.employer, name, 'label'),
    description: claim(project.description, (text) => mapLines(text, map), 'text'),
  };
}

/** Всё, что показывает лист и файл резюме. */
function mapDocument(document: ResumeDocument, lang: ResumeLang, map: Map1): ResumeDocument {
  const name = named(lang);
  const { contact } = document;
  return {
    ...document,
    targetRole: document.targetRole ? map(document.targetRole, 'text') : document.targetRole,
    contact: {
      ...contact,
      fullName: contact.fullName ? name(contact.fullName) : contact.fullName,
      location: contact.location ? map(contact.location, 'label') : contact.location,
    },
    ...(document.about ? { about: mapLines(document.about, map) } : {}),
    experience: document.experience.map((place) => mapPlace(place, map, name)),
    ...(document.skills
      ? { skills: document.skills.map((item) => ({ ...item, name: map(item.name, 'label') })) }
      : {}),
    education: document.education.map((item) => ({
      ...item,
      institution: claim(item.institution, name, 'label'),
      qualification: claim(item.qualification, map, 'label'),
    })),
    languages: document.languages.map((item) => ({
      ...item,
      name: claim(item.name, map, 'label'),
    })),
    ...(document.courses
      ? {
          courses: document.courses.map((item) => ({
            ...item,
            name: map(item.name, 'label'),
            ...(item.provider ? { provider: name(item.provider) } : {}),
            ...(item.institution ? { institution: name(item.institution) } : {}),
          })),
        }
      : {}),
    ...(document.projects
      ? { projects: document.projects.map((item) => mapProject(item, map, name)) }
      : {}),
  };
}

function collect(document: ResumeDocument, lang: ResumeLang): Line[] {
  const found = new Map<string, Line>();
  mapDocument(document, lang, (text, kind) => {
    const line = { kind, text };
    // Одна строка как «Go» бывает и пунктом, и навыком: строже проверяется текст.
    if (needs(line, lang) && (!found.has(text) || kind === 'text')) found.set(text, line);
    return text;
  });
  return [...found.values()];
}

/** Язык самого резюме: каким оно собрано из профиля. */
export function documentLang(document: ResumeDocument): ResumeLang {
  const texts = document.experience.flatMap((place) => [
    place.title?.value ?? '',
    place.description?.value ?? '',
    ...place.bullets.map((bullet) => bullet.value),
  ]);
  return textLanguage([document.about ?? '', ...texts].join(' ')) ?? 'ru';
}

/** Перевод целиком или прежний документ: половины резюме на другом языке не бывает. */
export function translatedDocument(
  document: ResumeDocument,
  lang: ResumeLang | undefined,
  translations: ResumeTranslations,
): ResumeDocument {
  if (!lang || lang === documentLang(document) || missing(document, lang, translations).length > 0)
    return document;
  return mapDocument(document, lang, (text, kind) =>
    needs({ text, kind }, lang) ? (translations[translationKey(lang, text)] ?? text) : text,
  );
}

function missing(document: ResumeDocument, lang: ResumeLang, translations: ResumeTranslations) {
  return collect(document, lang).filter(
    (line) => translations[translationKey(lang, line.text)] === undefined,
  );
}

export function isTranslated(
  document: ResumeDocument,
  lang: ResumeLang,
  translations: ResumeTranslations,
): boolean {
  return missing(document, lang, translations).length === 0;
}

function segments(text: string): string[] {
  if (text.length <= SEGMENT_MAX) return [text];
  return text.split(/(?<=[.!?;])\s+/u).filter(Boolean);
}

function checked(line: Line, answer: string, lang: ResumeLang): string | null {
  const text = answer.trim();
  if (!text || (lang === 'en' && CYRILLIC.test(text)) || !keepsSourceNumbers(text, line.text))
    return null;
  if (addsPersonalAction(line.text, text)) return null;
  // Короткая строка (должность, навык) короче пункта: длину пункта с неё не спрашиваем.
  if (line.kind === 'label' || line.text.length <= 60)
    return text.length <= LABEL_MAX ? text : null;
  return (
    checkedBullet({ text, sourceFactIds: ['0'] }, new Map([['0', line.text]]), lang)?.text ?? null
  );
}

type Answer = { readonly kind: 'ok'; readonly text: string } | { readonly kind: 'bad' | 'silent' };

async function askSegment(
  translate: NonNullable<LetterFactTranslator['translate']>,
  line: Line,
  lang: ResumeLang,
): Promise<Answer> {
  let answered = false;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const output = await translate({
      bullets: [{ key: '0', language: lang, text: line.text, facts: [line.text] }],
    }).catch(() => null);
    const raw = output?.bullets.find((bullet) => bullet.key === '0')?.text;
    if (raw === undefined) continue;
    answered = true;
    const text = checked(line, raw, lang);
    if (text) return { kind: 'ok', text };
  }
  return { kind: answered ? 'bad' : 'silent' };
}

async function askLine(
  translate: NonNullable<LetterFactTranslator['translate']>,
  line: Line,
  lang: ResumeLang,
): Promise<string | undefined> {
  const parts = await Promise.all(
    segments(line.text).map((text) => askSegment(translate, { ...line, text }, lang)),
  );
  if (parts.some((part) => part.kind === 'silent')) return undefined;
  const texts = parts.flatMap((part) => (part.kind === 'ok' ? [part.text] : []));
  if (texts.length === parts.length) return texts.join(' ');
  // Город, навык или диплом не теряем: их передаём латиницей.
  return line.kind === 'label' && lang === 'en' ? transliterate(line.text) : '';
}

export interface TranslationResult {
  /** Прежние и новые переводы: повтор после сбоя просит только недостающее. */
  readonly translations: ResumeTranslations;
  readonly complete: boolean;
}

export async function translateDocument(
  document: ResumeDocument,
  lang: ResumeLang,
  known: ResumeTranslations,
  translator: LetterFactTranslator | undefined,
  budgetMs: number,
): Promise<TranslationResult> {
  const all = collect(document, lang);
  const queue = missing(document, lang, known);
  const arrived = new Map<string, string>();
  const translate = translator?.translate?.bind(translator);
  if (queue.length > 0 && translate) {
    const deadline = Date.now() + budgetMs;
    const worker = async () => {
      for (let line = queue.shift(); line && Date.now() < deadline; line = queue.shift()) {
        const text = await askLine(translate, line, lang);
        if (text !== undefined) arrived.set(translationKey(lang, line.text), text);
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budgetMs);
    });
    await Promise.race([Promise.all(Array.from({ length: PARALLEL }, worker)), expired]);
    clearTimeout(timer);
  }
  const translations = { ...known, ...Object.fromEntries(arrived) };
  const dropped = all.filter((line) => translations[translationKey(lang, line.text)] === '');
  if (dropped.length > all.length * MAX_DROPPED_SHARE)
    return { translations: known, complete: false };
  return { translations, complete: isTranslated(document, lang, translations) };
}
