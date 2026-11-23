import { extractSkillsFromText } from '../connectors/telegramChannelParser';
import type { VacancyRequirement } from './vacancyRequirements';

/** A chip holds a skill name, never a sentence (B510: prod showed 3–4 line requirements). */
const MAX_LABEL_WORDS = 5;
const MAX_LABEL_CHARS = 40;

/** «Playwright.» from a bullet list is a name; a sentence of more than five words is not. */
export function shortRequirementLabel(text: string): string | undefined {
  const trimmed = text.trim().replace(/[.;]+$/u, '');
  return trimmed.length > 0 && trimmed.length <= MAX_LABEL_CHARS
    && trimmed.split(/\s+/u).length <= MAX_LABEL_WORDS && !/[.!?:]/u.test(trimmed) ? trimmed : undefined;
}

const LANGUAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/english|английск/iu, 'Английский'], [/german|немецк/iu, 'Немецкий'],
  [/french|французск/iu, 'Французский'], [/spanish|испанск/iu, 'Испанский'],
];

function kindLabel(requirement: VacancyRequirement): string | undefined {
  const text = requirement.text;
  switch (requirement.kind) {
    case 'experience':
      return requirement.minYears ? `Опыт от ${requirement.minYears} ${requirement.minYears === 1 ? 'года' : 'лет'}` : undefined;
    case 'language': {
      const language = LANGUAGES.find(([pattern]) => pattern.test(text))?.[1];
      if (!language) return undefined;
      const level = text.match(/\b([ABC][12])\b/u)?.[1];
      return level ? `${language} ${level}` : language;
    }
    case 'education': return 'Высшее образование';
    case 'license': return 'Лицензия или допуск';
    case 'workAuthorization': return 'Право на работу';
    case 'workFormat':
      return /remote|удал[её]н/iu.test(text) ? 'Удалённая работа' : /hybrid|гибрид/iu.test(text) ? 'Гибридный формат' : 'Работа в офисе';
    default: return undefined;
  }
}

const MAX_ALTERNATIVES = 3;
/** Between two skills: «или», «or», «/» or a comma of the same list («Python, Go или Java»). */
const JOINT = /^\s*(?:,|\/|или|or)\s*$/iu;
const ALTERNATIVE = /\/|или|\bor\b/iu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Where the skill is named in the text: a whole word, any case; `null` — not named as is. */
function skillSpan(text: string, skill: string): { start: number; end: number } | null {
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(skill)}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/** At most three names and a chip's length: «Team Lead или Engineering Manager…». */
function fittingAlternatives(names: readonly string[]): string[] {
  const shown: string[] = [];
  for (const name of names.slice(0, MAX_ALTERNATIVES)) {
    const next = [...shown, name];
    if (shown.length >= 2 && next.join(' или ').length + 1 > MAX_LABEL_CHARS) break;
    shown.push(name);
  }
  return shown;
}

/**
 * «Java или Go» is one requirement with a choice: naming only the first skill changes its meaning.
 * Only skills joined by «или» / «or» / «/» (a comma may join the list); «и» keeps the first skill.
 */
function alternativesLabel(text: string, skills: readonly string[]): string | undefined {
  if (skills.length < 2) return undefined;
  const spans = skills.map((skill) => ({ skill, span: skillSpan(text, skill) }));
  if (spans.some((item) => item.span === null)) return undefined;
  const ordered = [...spans].sort((a, b) => a.span!.start - b.span!.start);
  const joints = ordered.slice(1).map((item, index) => text.slice(ordered[index].span!.end, item.span!.start));
  if (!joints.every((joint) => JOINT.test(joint)) || !joints.some((joint) => ALTERNATIVE.test(joint))) return undefined;
  const names = ordered.map((item) => item.skill);
  const shown = fittingAlternatives(names);
  return shown.length < names.length ? `${shown.join(' или ')}…` : shown.join(' или ');
}

/**
 * Short chip name and whether a quiz can check it. A known skill named in the requirement wins;
 * a short requirement is its own name; conditions get a normalized Russian name; a long sentence
 * without a known skill gets no label and never becomes a chip. The full text stays in `text`.
 */
export function labelVacancyRequirement(requirement: VacancyRequirement): VacancyRequirement {
  // The model's label (labels-1) wins; the rules only fill caches written before it.
  if (requirement.label) return requirement;
  const skillKinds = requirement.kind === 'other' || requirement.kind === 'experience';
  const skills = skillKinds ? extractSkillsFromText(requirement.text) : [];
  const skill = alternativesLabel(requirement.text, skills) ?? skills[0];
  if (skill) return { ...requirement, label: skill, skill: true };
  const short = shortRequirementLabel(requirement.text);
  if (short) return { ...requirement, label: short, skill: requirement.kind === 'other' };
  const label = kindLabel(requirement);
  return { ...requirement, ...(label ? { label } : {}), skill: false };
}
