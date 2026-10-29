import type { ResumeDraft } from './resumeTypes';

export interface ProfileCompleteness {
  readonly completedCount: number;
  readonly totalCount: number;
  readonly missingSections: readonly string[];
}

/**
 * Only REQUIRED blocks count (walk 29.10, C1/C9): Имя, Контакты, Опыт,
 * Образование, Навыки, Языки. Проекты, Курсы, Сертификаты, Рекомендации and
 * Достижения are optional — a person without them is not behind, so they are
 * never a gap: not in the percent, not in «Сегодня», not in «собрано N из M».
 */
const PROFILE_BLOCKS: readonly {
  readonly label: string;
  readonly hasValue: (draft: ResumeDraft) => boolean;
}[] = [
  { label: 'Имя', hasValue: (draft) => Boolean(draft.candidate.fullName?.trim()) },
  {
    label: 'Контакты',
    hasValue: (draft) => {
      const contact = draft.candidate.contact;
      return Boolean(
        contact?.email?.trim() ||
        contact?.phone?.trim() ||
        contact?.links?.some((link) => link.trim()),
      );
    },
  },
  {
    label: 'Опыт',
    hasValue: (draft) =>
      draft.experience.length > 0 &&
      draft.experience.every((entry) =>
        Boolean(entry.startDate && (entry.current || entry.endDate)),
      ),
  },
  { label: 'Образование', hasValue: (draft) => draft.education.length > 0 },
  { label: 'Навыки', hasValue: (draft) => Boolean(draft.skills?.length) },
  { label: 'Языки', hasValue: (draft) => draft.languages.length > 0 },
];

export function profileCompleteness(draft: ResumeDraft): ProfileCompleteness {
  const missingSections = PROFILE_BLOCKS.filter((block) => !block.hasValue(draft)).map(
    (block) => block.label,
  );
  return {
    completedCount: PROFILE_BLOCKS.length - missingSections.length,
    totalCount: PROFILE_BLOCKS.length,
    missingSections,
  };
}

/** Achievements are present when listed, or when workplace bullet points carry them. */
export function hasAchievements(draft: ResumeDraft): boolean {
  return (
    Boolean(draft.achievements?.length) ||
    draft.experience.some((entry) => entry.bulletMemoryIds.length > 0)
  );
}
