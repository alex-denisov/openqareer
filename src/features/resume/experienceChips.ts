import { teamSizeLabel } from './ProfileTeamSizeTag';
import type { ResumeExperienceInput } from './resumeTypes';

export type ProfileLanguage = 'en' | 'ru';

export interface ExperienceChip {
  readonly key: 'current' | 'location' | 'workplace' | 'employment' | 'team';
  readonly label: string;
  readonly accent?: boolean;
}

const CYRILLIC = /[Ѐ-ӿ]/gu;
const LATIN = /[A-Za-z]/gu;
const REMOTE_LOCATION = /^(remote|удал[её]нн?о|удал[её]нная работа)$/iu;

/** The profile's own language: chips built from its data speak it (owner, 02.11). */
export function profileLanguage(texts: readonly (string | undefined)[]): ProfileLanguage {
  const text = texts.filter(Boolean).join(' ');
  const cyrillic = text.match(CYRILLIC)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  return cyrillic > latin ? 'ru' : 'en';
}

const WORKPLACE: Readonly<Record<string, Record<ProfileLanguage, string>>> = {
  on_site: { en: 'On-site', ru: 'Офис' },
  hybrid: { en: 'Hybrid', ru: 'Гибрид' },
  remote: { en: 'Remote', ru: 'Удалённо' },
};

const EMPLOYMENT: Readonly<Record<string, Record<ProfileLanguage, string>>> = {
  'full-time': { en: 'Full-time', ru: 'Полная занятость' },
  'полная занятость': { en: 'Full-time', ru: 'Полная занятость' },
  'part-time': { en: 'Part-time', ru: 'Частичная занятость' },
  'частичная занятость': { en: 'Part-time', ru: 'Частичная занятость' },
  'self-employed': { en: 'Self-employed', ru: 'Самозанятость' },
  самозанятость: { en: 'Self-employed', ru: 'Самозанятость' },
  contract: { en: 'Contract', ru: 'Контракт' },
  контракт: { en: 'Contract', ru: 'Контракт' },
  freelance: { en: 'Freelance', ru: 'Фриланс' },
  фриланс: { en: 'Freelance', ru: 'Фриланс' },
  internship: { en: 'Internship', ru: 'Стажировка' },
  стажировка: { en: 'Internship', ru: 'Стажировка' },
};

/** The text names the team size already («250+ professionals»): the chip would repeat it. */
function textNamesNumber(texts: readonly string[], value: number): boolean {
  const pattern = new RegExp(`(^|[^\\d])${value}(?![\\d])`, 'u');
  return texts.some((text) => pattern.test(text));
}

function workplaceChip(entry: ResumeExperienceInput, lang: ProfileLanguage) {
  const remoteLocation = REMOTE_LOCATION.test(entry.location?.trim() ?? '');
  const type = entry.workplaceType ?? (remoteLocation ? 'remote' : undefined);
  const label = type ? WORKPLACE[type]?.[lang] : undefined;
  return { remoteLocation, chip: label ? { key: 'workplace' as const, label } : null };
}

/** One chip row per place, every chip in one style and one language, no duplicates. */
export function experienceChips(
  entry: ResumeExperienceInput,
  texts: readonly string[],
  lang: ProfileLanguage,
): readonly ExperienceChip[] {
  const { remoteLocation, chip: workplace } = workplaceChip(entry, lang);
  const location = entry.location?.trim();
  const employment = entry.employmentType?.trim();
  const chips: (ExperienceChip | null)[] = [
    entry.current
      ? { key: 'current', label: lang === 'en' ? 'Current' : 'Работаю здесь', accent: true }
      : null,
    location && !remoteLocation ? { key: 'location', label: location } : null,
    workplace,
    employment
      ? { key: 'employment', label: EMPLOYMENT[employment.toLowerCase()]?.[lang] ?? employment }
      : null,
    entry.teamSize && !textNamesNumber(texts, entry.teamSize)
      ? {
          key: 'team',
          label:
            lang === 'en' ? `Team: ${entry.teamSize}` : `Команда: ${teamSizeLabel(entry.teamSize)}`,
        }
      : null,
  ];
  return chips.filter((chip): chip is ExperienceChip => chip !== null);
}
