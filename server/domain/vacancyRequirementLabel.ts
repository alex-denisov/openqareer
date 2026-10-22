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

/**
 * Short chip name and whether a quiz can check it. A known skill named in the requirement wins;
 * a short requirement is its own name; conditions get a normalized Russian name; a long sentence
 * without a known skill gets no label and never becomes a chip. The full text stays in `text`.
 */
export function labelVacancyRequirement(requirement: VacancyRequirement): VacancyRequirement {
  const skillKinds = requirement.kind === 'other' || requirement.kind === 'experience';
  const skill = skillKinds ? extractSkillsFromText(requirement.text)[0] : undefined;
  if (skill) return { ...requirement, label: skill, skill: true };
  const short = shortRequirementLabel(requirement.text);
  if (short) return { ...requirement, label: short, skill: requirement.kind === 'other' };
  const label = kindLabel(requirement);
  return { ...requirement, ...(label ? { label } : {}), skill: false };
}
