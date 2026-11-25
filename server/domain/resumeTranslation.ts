import type { ResumeLang } from '../../shared/resumeVacancyEdits';
import type { LetterFactTranslator } from './letterFactTranslation';
import { latinEmployerNames, transliterate, withLatinEmployerNames } from './letterLatinEmployers';
import { textLanguage } from './profileLanguage';
import type { ResumeDocument, ResumeExperience, ResumeProject } from './resumeStudioTypes';
import {
  checkedTranslation,
  isFaithful,
  languageName,
  needsTranslation,
  type ResumeLine as Line,
  type ResumeLineKind as Kind,
} from './resumeTranslationCheck';

/**
 * B785, o03: резюме под вакансию на другом языке. Строки переводит тот же переводчик, что пункты «Опыта»,
 * и каждая проходит проверку: те же числа и валюты, ни личного действия сверх исходной строки. Имена
 * людей, компаний и вузов отдельно в модель не уходят: в английском резюме они транслитерируются.
 * Состав фактов на обоих языках один: непереведённая строка остаётся исходной. Отклонённая дважды
 * хранится как есть (перевод равен строке); должность, сохранённая так раньше,
 * спрашивается ещё один раз; строка без ответа спрашивается снова.
 */
export type ResumeTranslations = Readonly<Record<string, string>>;

const CYRILLIC = /\p{Script=Cyrillic}/u;
const SEGMENT_MAX = 240;
const ATTEMPTS = 2;
const PARALLEL = 30;
/** Больше трети строк не переведено: такое резюме не показываем. */
const MAX_SOURCE_SHARE = 1 / 3;

export const translationKey = (lang: ResumeLang, text: string) => `${lang}:${text}`;
/** Должность оставлена как есть после вопроса: «Scrum Master» больше не спрашивается. */
const askedKey = (lang: ResumeLang, text: string) => `asked:${translationKey(lang, text)}`;

const reasked = ({ kind }: Line) => kind === 'title' || kind === 'term';

type Map1 = (text: string, kind: Kind) => string;
type Claim = { readonly value: string };

function claim<T extends Claim>(item: T | null | undefined, map: Map1, kind: Kind): T | null {
  if (!item) return null;
  const value = map(item.value, kind);
  return value ? { ...item, value } : null;
}

/** Название латиницей: написание кандидата, иначе транслитерация. */
const named = (lang: ResumeLang, names: ReadonlyMap<string, string>) => (text: string) =>
  lang === 'en' && CYRILLIC.test(text) ? transliterate(withLatinEmployerNames(text, names)) : text;

/** Где кандидат сам пишет названия: резюме и подтверждённые факты. */
function latinNamesOf(
  document: ResumeDocument,
  facts: readonly string[],
): ReadonlyMap<string, string> {
  const employers = document.experience.flatMap(({ employer }) => employer?.value ?? []);
  const institutions = document.education.flatMap(({ institution }) => institution?.value ?? []);
  const texts = document.experience.flatMap((place) => [
    place.description?.value ?? '',
    ...place.bullets.map(({ value }) => value),
  ]);
  return latinEmployerNames(
    [...employers, ...institutions],
    [...facts, document.about ?? '', ...texts],
  );
}

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
    title: claim(place.title, map, 'title'),
    employer: claim(place.employer, name, 'label'),
    location: claim(place.location, map, 'term'),
    ...(place.description ? { description: claim(place.description, lines, 'text') } : {}),
    bullets: place.bullets.flatMap((bullet) => claim(bullet, lines, 'text') ?? []),
  };
}

/** Имя из одного слова («OptiLab», «e-therapy») — собственное: его не переводят. */
const isProperName = (text: string) => !/\s/u.test(text.trim());

const projectName = (text: string, map: Map1, name: (text: string) => string) =>
  isProperName(text) ? name(text) : name(map(text, 'term'));

function mapProject(project: ResumeProject, map: Map1, name: (text: string) => string) {
  return {
    ...project,
    name: { ...project.name, value: projectName(project.name.value, map, name) },
    employer: claim(project.employer, name, 'label'),
    description: claim(project.description, (text) => mapLines(text, map), 'text'),
  };
}

/** Всё, что показывает лист и файл резюме. */
function mapDocument(
  document: ResumeDocument,
  lang: ResumeLang,
  map: Map1,
  names: ReadonlyMap<string, string> = new Map(),
): ResumeDocument {
  const name = named(lang, names);
  const { contact } = document;
  return {
    ...document,
    targetRole: document.targetRole ? map(document.targetRole, 'title') : document.targetRole,
    contact: {
      ...contact,
      fullName: contact.fullName ? name(contact.fullName) : contact.fullName,
      location: contact.location ? map(contact.location, 'term') : contact.location,
    },
    ...(document.about ? { about: mapLines(document.about, map) } : {}),
    experience: document.experience.map((place) => mapPlace(place, map, name)),
    ...(document.skills
      ? { skills: document.skills.map((item) => ({ ...item, name: map(item.name, 'label') })) }
      : {}),
    education: document.education.map((item) => ({
      ...item,
      institution: claim(item.institution, name, 'label'),
      qualification: claim(item.qualification, map, 'term'),
    })),
    languages: document.languages.map((item) => ({
      ...item,
      name: claim(item.name, map, 'term'),
    })),
    ...(document.courses
      ? {
          courses: document.courses.map((item) => ({
            ...item,
            name: name(map(item.name, 'term')),
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
    if (
      needsTranslation(line, lang) &&
      languageName(text, lang) === undefined &&
      (!found.has(text) || kind === 'text')
    )
      found.set(text, line);
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

/** Названия компаний остаются в переводе как есть. */
function companiesOf(document: ResumeDocument): string[] {
  const projects = (document.projects ?? []).map(({ name }) => name.value.trim());
  const employers = document.experience.flatMap(({ employer }) => employer?.value.trim() || []);
  const texts = [
    document.about ?? '',
    ...document.experience.flatMap((place) => [
      place.description?.value ?? '',
      ...place.bullets.map(({ value }) => value),
    ]),
    ...(document.projects ?? []).map(({ description }) => description?.value ?? ''),
  ];
  // «e-therapy» — имя продукта, где бы оно ни стояло.
  const products = [...projects, ...employers, ...texts].flatMap(
    (text) =>
      text.match(
        /(?<![\p{L}\p{N}-])e-(?!commerce|learning|mail|gov|sign|doc|business|wallet|book|bike|scooter|invoic|procure|bank|pay|health|shop|ticket|services?|money|trad)\p{Script=Latin}+(?![\p{L}\p{N}-])/giu,
      ) ?? [],
  );
  return [
    ...new Set([
      ...employers,
      ...projects.filter((text) => text && isProperName(text)),
      ...products,
    ]),
  ];
}

type Answered = 'translated' | 'rejected' | 'missing';

function reader(document: ResumeDocument, lang: ResumeLang, translations: ResumeTranslations) {
  const companies = companiesOf(document);
  return (line: Line): Answered => {
    const text = translations[translationKey(lang, line.text)];
    // Должность, сохранённая как есть до отметки, спрашивается ещё один раз.
    if (text === line.text)
      return reasked(line) && !(askedKey(lang, line.text) in translations)
        ? 'missing'
        : 'rejected';
    // Перевод, сохранённый до проверки чисел, спрашивается заново.
    return text && isFaithful(line, text, lang, companies) ? 'translated' : 'missing';
  };
}

/**
 * Документ на языке `lang` или прежний, если переведено мало. `basis` — резюме до подгонки объёма:
 * по нему и экран, и версия одинаково решают, показывать ли перевод.
 */
export function translatedDocument(
  document: ResumeDocument,
  lang: ResumeLang | undefined,
  translations: ResumeTranslations,
  basis: ResumeDocument = document,
  facts: readonly string[] = [],
): ResumeDocument {
  const own = documentLang(basis);
  // Английское резюме без перевода: названия и имена латиницей, остальное прежнее.
  if (own === 'en' && (lang ?? own) === own) {
    const names = latinNamesOf(basis, facts);
    return mapDocument(document, 'en', (text) => withLatinEmployerNames(text, names), names);
  }
  if (!lang || lang === own || !isTranslated(basis, lang, translations)) return document;
  const read = reader(basis, lang, translations);
  const translate: Map1 = (text, kind) => {
    const line = { text, kind };
    if (!needsTranslation(line, lang)) return text;
    const known = languageName(text, lang);
    if (known) return known;
    return read(line) === 'translated' ? (translations[translationKey(lang, text)] ?? text) : text;
  };
  return mapDocument(document, lang, translate, latinNamesOf(basis, facts));
}

export function isTranslated(
  document: ResumeDocument,
  lang: ResumeLang,
  translations: ResumeTranslations,
): boolean {
  const all = collect(document, lang);
  const read = reader(document, lang, translations);
  const source = all.filter((line) => read(line) !== 'translated');
  return source.length <= all.length * MAX_SOURCE_SHARE;
}

function segments(text: string): string[] {
  if (text.length <= SEGMENT_MAX) return [text];
  return text.split(/(?<=[.!?;])\s+/u).filter(Boolean);
}

type Answer = { readonly kind: 'ok'; readonly text: string } | { readonly kind: 'bad' | 'silent' };

async function askSegment(
  translate: NonNullable<LetterFactTranslator['translate']>,
  line: Line,
  lang: ResumeLang,
  companies: readonly string[],
): Promise<Answer> {
  let answered = false;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const output = await translate({
      bullets: [{ key: '0', language: lang, text: line.text, facts: [line.text], line: line.kind }],
    }).catch(() => null);
    const raw = output?.bullets.find((bullet) => bullet.key === '0')?.text;
    if (raw === undefined) continue;
    answered = true;
    const text = checkedTranslation(line, raw, lang, companies);
    if (text) return { kind: 'ok', text };
  }
  return { kind: answered ? 'bad' : 'silent' };
}

async function askLine(
  translate: NonNullable<LetterFactTranslator['translate']>,
  line: Line,
  lang: ResumeLang,
  companies: readonly string[],
): Promise<string | undefined> {
  const parts = await Promise.all(
    segments(line.text).map((text) => askSegment(translate, { ...line, text }, lang, companies)),
  );
  if (parts.some((part) => part.kind === 'silent')) return undefined;
  const texts = parts.flatMap((part) => (part.kind === 'ok' ? [part.text] : []));
  if (texts.length === parts.length) return texts.join(' ');
  // Город, навык или диплом передаём латиницей, остальное остаётся исходным.
  const short = line.kind === 'label' || line.kind === 'term';
  return short && lang === 'en' ? transliterate(line.text) : line.text;
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
  const companies = companiesOf(document);
  const read = reader(document, lang, known);
  const queue = all.filter((line) => read(line) === 'missing');
  const arrived = new Map<string, string>();
  const asked = new Map<string, string>();
  const translate = translator?.translate?.bind(translator);
  if (queue.length > 0 && translate) {
    const deadline = Date.now() + budgetMs;
    const worker = async () => {
      for (let line = queue.shift(); line && Date.now() < deadline; line = queue.shift()) {
        const text = await askLine(translate, line, lang, companies);
        if (text === undefined) continue;
        arrived.set(translationKey(lang, line.text), text);
        if (reasked(line) && text === line.text) asked.set(askedKey(lang, text), text);
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budgetMs);
    });
    await Promise.race([Promise.all(Array.from({ length: PARALLEL }, worker)), expired]);
    clearTimeout(timer);
  }
  const translations = { ...known, ...Object.fromEntries([...arrived, ...asked]) };
  const final = reader(document, lang, translations);
  const rejected = all.filter((line) => final(line) === 'rejected');
  if (rejected.length > all.length * MAX_SOURCE_SHARE)
    return { translations: { ...known, ...Object.fromEntries(asked) }, complete: false };
  return { translations, complete: isTranslated(document, lang, translations) };
}
