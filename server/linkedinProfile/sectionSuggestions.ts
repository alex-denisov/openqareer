import {
  LINKEDIN_SECTION_LIMITS, LINKEDIN_SKILLS_MAX,
  type LinkedinSection, type LinkedinSectionFact, type LinkedinSectionItem, type LinkedinSectionSuggestion,
} from '../../shared/b640LinkedinProfile';
import type { ResumeDraft } from '../domain/resumeDraft';

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
export type SectionSuggestions = Readonly<Record<LinkedinSection, LinkedinSectionSuggestion | null>>;

const HEADLINE_SKILLS = 4;
const ABOUT_FACTS = 5;
const EXPERIENCE_PLACES = 6;
/** Темы, о которых можно писать в профиле: пробелы, ограничения и пожелания — нет. */
const PROFILE_DOMAINS: ReadonlySet<string> = new Set(['responsibility', 'outcome', 'role-evidence', 'skill']);
const NUMBER = /\d+(?:[.,]\d+)?/gu;

const isConfirmed = (memory: SuggestionMemory): boolean => memory.status === 'confirmed' || memory.status === 'corrected';

/** Каждое число текста обязано стоять в одном из фактов: модель и склейка не добавляют цифр. */
export function numbersAreGrounded(text: string, facts: readonly LinkedinSectionFact[]): boolean {
  const normalize = (value: string) => (value.match(NUMBER) ?? []).map((n) => n.replace(',', '.'));
  const allowed = new Set(facts.flatMap((fact) => normalize(fact.text)));
  return normalize(text).every((number) => allowed.has(number));
}

function usableSkills(input: SuggestionInput): { id: string; name: string }[] {
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

function suggestHeadline(input: SuggestionInput): LinkedinSectionSuggestion | null {
  const role = input.draft?.targetRole?.trim() ?? '';
  const skills = usableSkills(input).slice(0, HEADLINE_SKILLS).map((skill) => skill.name);
  if (!role && skills.length === 0) return null;
  const last = input.draft?.experience[0];
  // Черновик по умолчанию «не текущий»: «Ex-» только при явной дате окончания.
  const employer = last && last.current === false && last.endDate?.trim() ? last.employer?.trim() : undefined;
  const tokens = [...(role ? [role] : []), ...skills, ...(employer ? [`Ex-${employer}`] : [])];
  const limit = LINKEDIN_SECTION_LIMITS.headline;
  while (tokens.length > 1 && tokens.join(' | ').length > limit) tokens.pop();
  const text = tokens.join(' | ').slice(0, limit).trimEnd();
  const kept = new Set(tokens);
  const keptSkills = skills.filter((name) => kept.has(name));
  const facts: LinkedinSectionFact[] = [
    ...(role ? [{ id: 'resume:targetRole', text: `Целевая роль: ${role}` }] : []),
    ...(keptSkills.length ? [{ id: 'resume:skills', text: `Навыки: ${keptSkills.join(', ')}` }] : []),
    ...(employer && last && kept.has(`Ex-${employer}`)
      ? [{ id: `resume:experience:${last.id}`, text: placeLine(last) ?? employer }] : []),
  ];
  return { text, facts };
}

function suggestSkills(input: SuggestionInput): LinkedinSectionSuggestion | null {
  const skills = usableSkills(input).slice(0, LINKEDIN_SKILLS_MAX);
  if (skills.length === 0) return null;
  return {
    text: skills.map((skill) => skill.name).join(' · '),
    facts: skills.map((skill) => ({ id: `resume:skill:${skill.id}`, text: skill.name })),
  };
}

const sentence = (statement: string): string => {
  const trimmed = statement.trim();
  return /[.!?…]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
};

function suggestAbout(input: SuggestionInput): LinkedinSectionSuggestion | null {
  const confirmed = input.memory
    .filter((memory) => isConfirmed(memory) && !memory.sensitive && PROFILE_DOMAINS.has(memory.domain ?? ''))
    .slice(0, ABOUT_FACTS);
  if (confirmed.length === 0) return null;
  const role = input.draft?.targetRole?.trim() ?? '';
  const facts: LinkedinSectionFact[] = [
    ...(role ? [{ id: 'resume:targetRole', text: `Целевая роль: ${role}` }] : []),
    ...confirmed.map((memory) => ({ id: memory.id, text: memory.statement.trim() })),
  ];
  const sentences = [...(role ? [sentence(role)] : []), ...confirmed.map((memory) => sentence(memory.statement))];
  const limit = LINKEDIN_SECTION_LIMITS.about;
  while (sentences.length > 1 && sentences.join(' ').length > limit) sentences.pop();
  const text = sentences.join(' ');
  const kept = facts.filter((fact) => fact.id === 'resume:targetRole' || text.includes(fact.text));
  return text.length <= limit && numbersAreGrounded(text, kept) ? { text, facts: kept } : null;
}

/** Фраз в предложении по одному месту работы: в макете их две-три. */
const PLACE_SENTENCES = 3;

function experienceItem(
  place: ResumeDraft['experience'][number],
  byId: ReadonlyMap<string, SuggestionMemory>,
): LinkedinSectionItem | null {
  const header = placeLine(place);
  const description = place.descriptionMemoryId ? byId.get(place.descriptionMemoryId) : undefined;
  const bullets = place.bulletMemoryIds.flatMap((id) => byId.get(id) ?? []);
  const used = [...(description ? [description] : []), ...bullets].slice(0, PLACE_SENTENCES);
  if (!header || used.length === 0) return null;
  const facts = [
    { id: `resume:experience:${place.id}`, text: header },
    ...used.map((memory) => ({ id: memory.id, text: memory.statement.trim() })),
  ];
  const text = used.map((memory) => sentence(memory.statement)).join(' ');
  if (!numbersAreGrounded(text, facts)) return null;
  return { id: place.id, label: `${place.employer!.trim()} · ${place.title!.trim()}`, text, facts };
}

function suggestExperience(input: SuggestionInput): LinkedinSectionSuggestion | null {
  const byId = new Map(input.memory.filter(isConfirmed).map((memory) => [memory.id, memory]));
  const items = (input.draft?.experience ?? [])
    .slice(0, EXPERIENCE_PLACES)
    .flatMap((place) => experienceItem(place, byId) ?? []);
  const text = items.map((item) => `${item.label}\n${item.text}`).join('\n\n');
  if (text.length === 0 || text.length > LINKEDIN_SECTION_LIMITS.experience) return null;
  return { text, facts: items.flatMap((item) => item.facts), items };
}

/** B692: предложения по разделам профиля LinkedIn только из подтверждённых фактов и данных черновика резюме. */
export function buildSectionSuggestions(input: SuggestionInput): SectionSuggestions {
  return {
    headline: suggestHeadline(input),
    about: suggestAbout(input),
    experience: suggestExperience(input),
    skills: suggestSkills(input),
  };
}
