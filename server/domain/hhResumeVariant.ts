import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HH_SECTION_TEXT_MAX_LENGTH, type HhResumeEdit } from '../../shared/hhCandidateSession';
import { checkedText } from '../linkedinProfile/linkedinRewrite';
import type { OnVariantReject, RetryableVariantRequest } from './checkedVariant';
import { addsPersonalAction } from './letterFactTranslation';
import type { HhEditDraft, HhEditLanguage } from './hhResumeEdits';

/**
 * B682 (a01c): «Другой вариант» правки резюме hh.ru — у опыта, навыков и «О себе». Факты только из
 * правки и подтверждённого профиля; у навыков меняются набор и порядок, новых навыков не появляется.
 */
export const HH_RESUME_VARIANT_PROMPT_REVISION = 'hh-resume-variant-2026-11-24-2';

export interface HhResumeVariantFact {
  readonly id: string;
  readonly text: string;
}

export interface HhResumeVariantRequest extends RetryableVariantRequest {
  readonly target: 'experience' | 'about' | 'skills';
  readonly language: HhEditLanguage;
  readonly vacancyTitle: string;
  /** Только у места работы: работодатель и период. */
  readonly label?: string;
  readonly facts: readonly HhResumeVariantFact[];
  /** Навыки, которые уже стоят в резюме: hh.ru их не убирает, в ответе они остаются все. */
  readonly keep: readonly string[];
  /** Прежние тексты: новый не должен их повторять. */
  readonly avoid: readonly string[];
}

export const hhResumeVariantOutputSchema = z.object({
  text: z.string().max(6000),
  factIds: z.array(z.string().max(200)).max(80),
});
export type HhResumeVariantOutput = z.infer<typeof hhResumeVariantOutputSchema>;

export interface HhResumeVariantWriter {
  hhResumeVariant?(request: HhResumeVariantRequest): Promise<HhResumeVariantOutput | null>;
}

export interface HhResumeVariantText {
  readonly text: string;
  readonly added?: readonly string[];
}

const ABOUT_FACTS = 20;
/** Сколько навыков профиля предлагается сверх тех, что уже стоят в резюме. */
const EXTRA_SKILLS_MAX = 60;
const TITLE_MAX = 200;
const TEXT_MAX = Math.min(2000, HH_SECTION_TEXT_MAX_LENGTH);
const flat = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();

export function hasVariants(edit: Pick<HhResumeEdit, 'section'>): boolean {
  return edit.section !== 'title';
}

/** Вакансия + резюме + правка + хэш содержимого до перевода: номер места в резюме и перевод ключ не меняют. */
export function hhResumeVariantSubject(vacancyId: string, resumeId: string, draft: HhEditDraft): string {
  const place = [draft.place ?? '', draft.employer ?? '', draft.position ?? ''];
  return createHash('sha256')
    .update(JSON.stringify([vacancyId, resumeId, draft.section, place, draft.was, draft.now]))
    .digest('hex');
}

export interface HhResumeVariantInput {
  readonly edit: HhResumeEdit;
  readonly language: HhEditLanguage;
  readonly vacancyTitle: string;
  readonly resumeSkills: readonly string[];
  readonly profileSkills: readonly string[];
  readonly profileFacts: readonly string[];
  readonly avoid: readonly string[];
}

const numbered = (texts: readonly string[]): HhResumeVariantFact[] =>
  texts.map((text, index) => ({ id: `f${index + 1}`, text }));

function uniqueBy(texts: readonly string[]): string[] {
  const known = new Map(texts.map((text) => [flat(text), text.trim()] as const).reverse());
  return [...new Set(texts.map(flat))].flatMap((key) => (key ? [known.get(key)!] : []));
}

function factTexts(input: HhResumeVariantInput): string[] {
  const { edit } = input;
  if (edit.section === 'skills') {
    const listed = uniqueBy(input.resumeSkills).length;
    return uniqueBy([...input.resumeSkills, ...(edit.added ?? []), ...input.profileSkills]).slice(0, listed + EXTRA_SKILLS_MAX);
  }
  const own = edit.now.split('\n').map((line) => line.trim()).filter(Boolean);
  return edit.section === 'about' ? uniqueBy([...own, ...input.profileFacts]).slice(0, ABOUT_FACTS) : own;
}

/** Вход модели; `null` — вариантов у такой правки нет. */
export function hhResumeVariantRequest(input: HhResumeVariantInput): HhResumeVariantRequest | null {
  const { edit } = input;
  if (edit.section === 'title') return null;
  const facts = numbered(factTexts(input));
  if (facts.length === 0) return null;
  return {
    target: edit.section,
    language: input.language,
    vacancyTitle: input.vacancyTitle.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, TITLE_MAX),
    ...(edit.place ? { label: edit.place } : {}),
    facts,
    keep: edit.section === 'skills' ? input.resumeSkills : [],
    avoid: input.avoid,
  };
}

function checkedSkills(request: HhResumeVariantRequest, output: HhResumeVariantOutput): HhResumeVariantText | null {
  const allowed = new Map(request.facts.map((fact) => [flat(fact.text), fact.text]));
  const keep = new Set(request.keep.map(flat).filter(Boolean));
  const keys = output.text.split('\n').map(flat).filter(Boolean);
  const own = new Set(keys);
  const valid = own.size === keys.length && keys.every((key) => allowed.has(key)) && [...keep].every((key) => own.has(key));
  const added = keys.filter((key) => !keep.has(key)).map((key) => allowed.get(key)!);
  return valid && added.length > 0 ? { text: keys.map((key) => allowed.get(key)!).join(', '), added } : null;
}

/** Названия, которых нет в фактах: у русского текста — любое слово латиницей, у английского — с заглавной внутри фразы. */
export function addsNames(text: string, source: string, language: HhEditLanguage): boolean {
  const known = new Set(source.toLocaleLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? []);
  const names = language === 'ru'
    ? text.match(/[A-Za-z][A-Za-z0-9+#]*/gu) ?? []
    : [...text.matchAll(/(?<![.!?\n]\s*)(?<=\S\s)[A-Z][A-Za-z0-9+#]*/gu)].map(([name]) => name);
  return names.some((name) => !known.has(name.toLocaleLowerCase()));
}

function checkedLines(
  request: HhResumeVariantRequest, output: HhResumeVariantOutput, onReject?: OnVariantReject,
): HhResumeVariantText | null {
  const rule = { max: TEXT_MAX, allowed: request.facts, noFirstPerson: request.target === 'experience' };
  if (!checkedText(output, rule, request.language, onReject)) return null;
  const lines = output.text.split('\n').map((line) => line.replace(/\s+/gu, ' ').trim()).filter(Boolean);
  const source = request.facts.map((fact) => fact.text).join('\n');
  const text = lines.join('\n');
  const action = addsPersonalAction(source, text);
  const name = addsNames(text, source, request.language);
  if (action) onReject?.('action');
  if (name) onReject?.('name');
  return action || name ? null : { text };
}

/** Принятый вариант или `null`. */
export function checkHhResumeVariant(
  request: HhResumeVariantRequest,
  output: HhResumeVariantOutput,
  onReject?: OnVariantReject,
): HhResumeVariantText | null {
  const skills = request.target === 'skills';
  const checked = skills ? checkedSkills(request, output) : checkedLines(request, output, onReject);
  if (!checked) {
    if (skills) onReject?.('skills');
    return null;
  }
  const own = flat(checked.text);
  if (!request.avoid.some((previous) => flat(previous) === own)) return checked;
  onReject?.('repeat');
  return null;
}
