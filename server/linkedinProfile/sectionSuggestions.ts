import { LINKEDIN_HEADLINE_MAX, LINKEDIN_SKILLS_MAX } from '../../shared/b640LinkedinProfile';
import type { ResumeDraft } from '../domain/resumeDraft';

/**
 * Факт, на котором стоит предложение. Остаётся на сервере: по нему проверяется текст (B645 —
 * строки фактов на экране нет), наружу уходит только сам текст.
 */
export interface LinkedinSectionFact {
  readonly id: string;
  readonly text: string;
}
/** Предложение по одному месту работы в «Опыте». */
export interface LinkedinSectionItem {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly facts: readonly LinkedinSectionFact[];
}
export interface SectionSuggestion {
  readonly text: string;
  readonly facts: readonly LinkedinSectionFact[];
  readonly items?: readonly LinkedinSectionItem[];
}
export type SuggestedSection = 'headline' | 'about' | 'experience' | 'skills';

export interface SuggestionMemory {
  readonly id: string;
  readonly status: string;
  readonly statement: string;
  readonly domain?: string;
  readonly sensitive?: boolean;
}
export interface SuggestionInput {
  readonly memory: readonly SuggestionMemory[];
  readonly draft: Pick<ResumeDraft, 'targetRole' | 'experience' | 'skills'> | null | undefined;
}
export type SectionSuggestions = Readonly<Record<SuggestedSection, SectionSuggestion | null>>;

const HEADLINE_SKILLS = 3;
const NUMBER = /\d+(?:[.,]\d+)?/gu;

/** Каждое число текста обязано стоять в одном из фактов: модель и склейка не добавляют цифр. */
export function numbersAreGrounded(text: string, facts: readonly LinkedinSectionFact[]): boolean {
  const normalize = (value: string) => (value.match(NUMBER) ?? []).map((n) => n.replace(',', '.'));
  const allowed = new Set(facts.flatMap((fact) => normalize(fact.text)));
  return normalize(text).every((number) => allowed.has(number));
}

export function usableSkills(input: SuggestionInput): { id: string; name: string }[] {
  const status = new Map(input.memory.map((memory) => [memory.id, memory.status]));
  const seen = new Set<string>();
  return (input.draft?.skills ?? []).flatMap((skill) => {
    const name = skill.name.trim();
    const key = name.toLowerCase();
    const unconfirmed = skill.evidenceMemoryId !== undefined
      && !['confirmed', 'corrected'].includes(status.get(skill.evidenceMemoryId) ?? '');
    if (!name || seen.has(key) || unconfirmed) return [];
    seen.add(key);
    return [{ id: skill.id, name }];
  });
}

function placeLine(place: ResumeDraft['experience'][number]): string | null {
  if (!place.title?.trim() || !place.employer?.trim()) return null;
  const period = place.startDate
    ? ` (${place.startDate} — ${place.current ? 'по настоящее время' : (place.endDate ?? '…')})`
    : '';
  return `${place.title.trim()} — ${place.employer.trim()}${period}`;
}

/** Роль заголовка: целевая роль, иначе должность последнего места работы — это факт черновика. */
function headlineRole(input: SuggestionInput): { text: string; fact: LinkedinSectionFact } | null {
  const role = input.draft?.targetRole?.trim();
  if (role) return { text: role, fact: { id: 'resume:targetRole', text: `Целевая роль: ${role}` } };
  const last = input.draft?.experience[0];
  const title = last?.title?.trim();
  return last && title ? { text: title, fact: { id: `resume:experience:${last.id}`, text: placeLine(last) ?? title } } : null;
}

/** Заголовок фразой, как в макете a03: «роль · навыки через запятую», без списка через «|». */
function suggestHeadline(input: SuggestionInput): SectionSuggestion | null {
  const role = headlineRole(input);
  if (!role) return null;
  const skills = usableSkills(input).slice(0, HEADLINE_SKILLS).map((skill) => skill.name);
  const last = input.draft?.experience[0];
  // Черновик по умолчанию «не текущий»: «Ex-» только при явной дате окончания.
  const employer = last && last.current === false && last.endDate?.trim() ? last.employer?.trim() : undefined;
  const limit = LINKEDIN_HEADLINE_MAX;
  const compose = (kept: readonly string[], ex: boolean) =>
    [role.text, ...(kept.length ? [kept.join(', ')] : []), ...(ex && employer ? [`Ex-${employer}`] : [])].join(' · ');
  let kept = skills;
  let ex = Boolean(employer);
  while (compose(kept, ex).length > limit && (ex || kept.length > 0)) {
    if (ex) ex = false;
    else kept = kept.slice(0, -1);
  }
  const text = compose(kept, ex).slice(0, limit).trimEnd();
  const facts: LinkedinSectionFact[] = [
    role.fact,
    ...(kept.length ? [{ id: 'resume:skills', text: `Навыки: ${kept.join(', ')}` }] : []),
    ...(ex && employer && last && role.fact.id !== `resume:experience:${last.id}`
      ? [{ id: `resume:experience:${last.id}`, text: placeLine(last) ?? employer }] : []),
  ];
  return { text, facts };
}

function suggestSkills(input: SuggestionInput): SectionSuggestion | null {
  const skills = usableSkills(input).slice(0, LINKEDIN_SKILLS_MAX);
  if (skills.length === 0) return null;
  return {
    text: skills.map((skill) => skill.name).join(' · '),
    facts: skills.map((skill) => ({ id: `resume:skill:${skill.id}`, text: skill.name })),
  };
}

/** B692: предложения по разделам профиля LinkedIn только из подтверждённых фактов и данных черновика резюме. */
export function buildSectionSuggestions(input: SuggestionInput): SectionSuggestions {
  return {
    headline: suggestHeadline(input),
    // «О себе» и «Опыт» пишет модель пересказом фактов (B645, linkedinRewrite.ts), а не склейка фактов.
    about: null,
    experience: null,
    skills: suggestSkills(input),
  };
}
