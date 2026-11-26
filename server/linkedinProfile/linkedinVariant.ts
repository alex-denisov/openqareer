/**
 * B645 (a03): «Предложить заново» — модель пишет другой вариант одного предложения. Те же правила,
 * что у первого текста: только подтверждённые факты этого предложения, без новых чисел, без копии
 * источника и без повтора прежних вариантов. Не прошёл проверки — варианта нет.
 */
import { z } from 'zod';
import { LINKEDIN_HEADLINE_MAX, LINKEDIN_SKILLS_MAX } from '../../shared/b640LinkedinProfile';
import type { OnVariantReject, RetryableVariantRequest } from '../domain/checkedVariant';
import { textLanguage, type ProfileLanguage } from '../domain/profileLanguage';
import {
  ABOUT_RULE, answerText, checkedText, linkedinRewriteRequest, PLACE_RULE,
  type CheckRule,
} from './linkedinRewrite';
import { usableSkills, type LinkedinSectionFact, type SuggestionInput } from './sectionSuggestions';

export const LINKEDIN_VARIANT_PROMPT_REVISION = 'linkedin-profile-variant-2026-11-24';

export type LinkedinVariantTarget = 'headline' | 'about' | 'place' | 'skills';
export interface LinkedinVariantRequest extends RetryableVariantRequest {
  readonly target: LinkedinVariantTarget;
  readonly language: ProfileLanguage;
  readonly targetRole: string;
  /** Только у места работы: «Компания · Должность». */
  readonly label?: string;
  readonly facts: readonly LinkedinSectionFact[];
  /** Прежние варианты: новый не должен их повторять. */
  readonly avoid: readonly string[];
}
export const linkedinVariantOutputSchema = answerText;
export type LinkedinVariantOutput = z.infer<typeof linkedinVariantOutputSchema>;

export interface LinkedinVariantWriter {
  linkedinVariant?(request: LinkedinVariantRequest): Promise<LinkedinVariantOutput | null>;
}

const SKILL_SEP = ' · ';
const flat = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function headlineFacts(input: SuggestionInput): LinkedinSectionFact[] {
  const role = input.draft?.targetRole?.trim();
  return [
    ...(role ? [{ id: 'resume:targetRole', text: `Целевая роль: ${role}` }] : []),
    ...usableSkills(input).map((skill) => ({ id: `resume:skill:${skill.id}`, text: skill.name })),
    ...(input.draft?.experience ?? []).flatMap((place) =>
      place.title?.trim() && place.employer?.trim()
        ? [{ id: `resume:experience:${place.id}`, text: `${place.title.trim()} — ${place.employer.trim()}` }]
        : []),
  ];
}

/** Вход модели по ключу предложения; `null` — фактов для него нет. */
export function linkedinVariantRequest(
  key: string,
  input: SuggestionInput,
  avoid: readonly string[],
  currentAbout?: string,
): LinkedinVariantRequest | null {
  // Язык — как у первого текста: по нынешнему «О себе» из импорта, иначе по фактам.
  const base = linkedinRewriteRequest(input, currentAbout);
  const language = base?.language ?? textLanguage(avoid.join(' ')) ?? 'ru';
  const common = { language, targetRole: input.draft?.targetRole?.trim() ?? '', avoid };
  if (key === 'headline') {
    const facts = headlineFacts(input);
    return facts.length ? { ...common, target: 'headline', facts } : null;
  }
  if (key === 'skills') {
    const facts = usableSkills(input).map((skill) => ({ id: `resume:skill:${skill.id}`, text: skill.name }));
    return facts.length ? { ...common, target: 'skills', facts } : null;
  }
  if (key === 'about') return base?.aboutFacts.length ? { ...common, target: 'about', facts: base.aboutFacts } : null;
  const place = base?.places.find((item) => `experience:${item.id}` === key);
  return place ? { ...common, target: 'place', label: `${place.employer} · ${place.title}`, facts: place.facts } : null;
}

/** Навыки — только из списка кандидата, через «·», без повторов. */
function checkedSkills(request: LinkedinVariantRequest, output: LinkedinVariantOutput): string | null {
  const allowed = new Map(request.facts.map((item) => [flat(item.text), item.text]));
  const names = output.text.split(/\s*[·,;|]\s*/u).map((name) => name.trim()).filter(Boolean);
  const keys = names.map(flat);
  const valid = names.length > 0 && names.length <= LINKEDIN_SKILLS_MAX
    && new Set(keys).size === keys.length && keys.every((key) => allowed.has(key));
  return valid ? keys.map((key) => allowed.get(key)!).join(SKILL_SEP) : null;
}

const RULES: Readonly<Record<Exclude<LinkedinVariantTarget, 'skills'>, Omit<CheckRule, 'allowed'>>> = {
  headline: { max: LINKEDIN_HEADLINE_MAX, namesAllowed: true },
  about: ABOUT_RULE,
  place: PLACE_RULE,
};

/** Принятый текст варианта или `null`. */
export function checkLinkedinVariant(
  request: LinkedinVariantRequest,
  output: LinkedinVariantOutput,
  onReject?: OnVariantReject,
): string | null {
  const text = request.target === 'skills'
    ? checkedSkills(request, output)
    : checkedText(output, { ...RULES[request.target], allowed: request.facts }, request.language, onReject)?.text ?? null;
  if (!text) {
    if (request.target === 'skills') onReject?.('skills');
    return null;
  }
  const own = flat(text);
  if (!request.avoid.some((previous) => flat(previous) === own)) return text;
  onReject?.('repeat');
  return null;
}
