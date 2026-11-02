/**
 * Short Russian summary of a public catalog card (Yandex review, 03.11).
 *
 * Yandex Webmaster kept 8 of 4 476 sitemap pages and excluded job cards as
 * «Малоценная или маловостребованная страница»: a card was the employer's
 * English text under a Russian page chrome, i.e. a copy. The summary is our own
 * Russian text written by the bulk model from the card's text, never a
 * translation, and it states only what the text states. Salary is not asked of
 * the model: the page names it from the source's own label.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { minimizeModelText } from '../providers/modelInputPrivacy';

/** Bump when the prompt or the answer shape changes: every stored summary is regenerated. */
export const CATALOG_RU_SUMMARY_VERSION = 1;
export const CATALOG_RU_SUMMARY_TASK = 'catalog-ru-summary';
/** Below this the card has nothing to summarise beyond its title. */
export const CATALOG_RU_SUMMARY_SOURCE_MIN = 200;
/** The model reads at most this much of the text: the facts of a posting sit in its first pages. */
const SOURCE_MAX_CHARS = 8_000;
const REQUIREMENTS_MAX = 5;
/** A requirement longer than this is a pasted paragraph, not a short point; it is left out. */
const REQUIREMENT_MAX_CHARS = 120;

export interface CatalogRuSummaryFacts {
  readonly role?: string;
  readonly format?: string;
  readonly geography?: string;
  readonly requirements?: readonly string[];
  readonly audience?: string;
}

export interface CatalogRuSummary {
  /** 3–5 sentences of our own Russian text. */
  readonly text: string;
  readonly facts: CatalogRuSummaryFacts;
}

export interface CatalogRuSummarySource {
  readonly title: string;
  readonly company: string;
  readonly location?: string;
  readonly isRemote: boolean;
  /** The card's text as the page shows it: full text when loaded, else the description. */
  readonly description: string;
}

/** The first non-blank text, in the page's order: full text, description, catalog snippet. */
export function catalogSummarySourceText(...candidates: ReadonlyArray<string | undefined>): string {
  return candidates.find((text) => text !== undefined && text.trim().length > 0)?.trim() ?? '';
}

/**
 * The hash the stored summary is bound to: title and text, the two things the
 * model reads that can change. The page hides a summary whose hash no longer
 * matches, so a rewritten posting never shows a summary of its old text.
 */
export function catalogSummarySourceHash(title: string, description: string): string {
  return createHash('sha256').update(`${title.trim()}\n${description.trim()}`).digest('hex');
}

function plainText(text: string): string {
  return text
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export const CATALOG_RU_SUMMARY_PROMPT = [
  'Ты пишешь короткую справку о вакансии для русскоязычного каталога вакансий. Справка целиком на русском языке, даже если вакансия на английском или другом языке.',
  'Прочитай текст вакансии и ответь только JSON-объектом без пояснений:',
  '{"summary": string, "role": string|null, "format": string|null, "geography": string|null, "requirements": string[], "audience": string|null}',
  'summary — 3–5 предложений по-русски своими словами: чем предстоит заниматься, в какой команде или компании, что важно знать кандидату. Не переводи текст дословно и не копируй его фразы.',
  'role — роль и уровень одной строкой (например «Ведущий бухгалтер, senior»); уровень — только если он назван или однозначно следует из текста.',
  'format — формат работы: офис, гибрид или удалёнка, занятость.',
  'geography — где работать и кандидатов из каких стран или регионов берут; только если это сказано в тексте.',
  'requirements — до 5 ключевых требований, каждое не длиннее 10 слов; названия технологий и сертификатов оставь как в тексте.',
  'audience — одно предложение: кому подойдёт вакансия.',
  'Все поля пиши по-русски; по-английски оставь только названия компаний, продуктов, технологий и сертификатов.',
  'Пиши только то, что есть в тексте. Если факта в тексте нет — null (для requirements — пустой список). Ничего не додумывай.',
  'Не называй зарплату, ссылки, телефоны и адреса почты. Не пиши чисел, которых нет в тексте.',
].join('\n');

/** The model input: card facts, then the text. Contacts and links are removed before it leaves. */
export function catalogRuSummaryInput(source: CatalogRuSummarySource): string {
  const place = [source.location?.trim(), source.isRemote ? 'удалённо' : undefined]
    .filter(Boolean)
    .join(', ');
  return minimizeModelText(
    [
      `Должность: ${source.title.trim()}`,
      `Работодатель: ${source.company.trim()}`,
      place ? `Место: ${place}` : undefined,
      '',
      'Текст вакансии:',
      plainText(source.description).slice(0, SOURCE_MAX_CHARS),
    ]
      .filter((line) => line !== undefined)
      .join('\n'),
  );
}

const nullableText = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || undefined);

const answerSchema = z.object({
  summary: z.string(),
  role: nullableText,
  format: nullableText,
  geography: nullableText,
  requirements: z
    .array(z.string())
    .nullish()
    .transform((items) =>
      (items ?? [])
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= REQUIREMENT_MAX_CHARS)
        .slice(0, REQUIREMENTS_MAX),
    ),
  audience: nullableText,
});

function jsonBody(content: string): string {
  const trimmed = content.trim();
  return trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)?.[1] ?? trimmed;
}

function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?…])\s+/u).filter((part) => part.trim().length > 0).length;
}

function cyrillicShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  return (text.match(/\p{Script=Cyrillic}/gu) ?? []).length / letters.length;
}

/**
 * A fact left in English is the source's text, not ours: it is dropped rather
 * than shown under a Russian label. Names of products and technologies inside a
 * Russian phrase keep it Russian.
 */
function isRussianFact(value: string): boolean {
  return cyrillicShare(value) >= 0.3;
}

/** Numbers of two or more digits, without separators: «120 000» and «120,000» are the same. */
function numbersOf(text: string): string[] {
  return (text.match(/\d[\d\s.,]*\d/gu) ?? []).map((value) => value.replace(/[\s.,]/gu, ''));
}

/**
 * Why an answer cannot be shown, or undefined when it can. A number the text
 * does not contain is an invented fact; English output is a translation the
 * model was told not to give.
 */
export function catalogRuSummaryIssue(
  summary: CatalogRuSummary,
  source: CatalogRuSummarySource,
): string | undefined {
  const sentences = sentenceCount(summary.text);
  if (sentences < 2 || sentences > 6) return 'sentences';
  if (summary.text.length > 900) return 'too_long';
  const all = [summary.text, ...Object.values(summary.facts).flat()].join(' ');
  if (cyrillicShare(summary.text) < 0.6) return 'not_russian';
  if (/https?:\/\/|@\w/iu.test(all)) return 'contact';
  const known = numbersOf(
    `${source.title} ${source.company} ${source.location ?? ''} ${source.description}`,
  ).join(' ');
  if (numbersOf(all).some((number) => !known.includes(number))) return 'invented_number';
  return undefined;
}

/** The model's answer as a summary, or an error naming why it is unusable. */
export function parseCatalogRuSummary(
  content: string,
  source: CatalogRuSummarySource,
): { summary: CatalogRuSummary } | { issue: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(content));
  } catch {
    return { issue: 'not_json' };
  }
  const answer = answerSchema.safeParse(parsed);
  if (!answer.success) return { issue: 'shape' };
  const { summary: text, requirements, ...facts } = answer.data;
  const russianRequirements = requirements.filter(isRussianFact);
  const summary: CatalogRuSummary = {
    text: text.trim().replace(/\s+/gu, ' '),
    facts: {
      ...Object.fromEntries(
        Object.entries(facts).filter(
          (entry): entry is [string, string] => entry[1] !== undefined && isRussianFact(entry[1]),
        ),
      ),
      ...(russianRequirements.length > 0 ? { requirements: russianRequirements } : {}),
    },
  };
  const issue = catalogRuSummaryIssue(summary, source);
  return issue ? { issue } : { summary };
}

/** The stored summary as the page reads it; anything else (an old shape, a damaged row) is none. */
const storedSchema = z.object({
  text: z.string().min(1),
  facts: z.object({
    role: z.string().optional(),
    format: z.string().optional(),
    geography: z.string().optional(),
    requirements: z.array(z.string()).optional(),
    audience: z.string().optional(),
  }),
});

export function readStoredCatalogRuSummary(json: string): CatalogRuSummary | undefined {
  try {
    const result = storedSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
