import type { ResumeDraft } from './resumeTypes';

export interface ProfileCompleteness {
  readonly completedCount: number;
  readonly totalCount: 11;
  readonly missingSections: readonly string[];
}

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
        contact?.location?.trim() ||
        contact?.links?.some((link) => link.trim()),
      );
    },
  },
  { label: 'Опыт', hasValue: (draft) => draft.experience.length > 0 },
  { label: 'Образование', hasValue: (draft) => draft.education.length > 0 },
  { label: 'Проекты', hasValue: (draft) => Boolean(draft.projects?.length) },
  { label: 'Навыки', hasValue: (draft) => Boolean(draft.skills?.length) },
  { label: 'Языки', hasValue: (draft) => draft.languages.length > 0 },
  { label: 'Курсы', hasValue: (draft) => Boolean(draft.courses?.length) },
  { label: 'Сертификаты', hasValue: (draft) => Boolean(draft.certifications?.length) },
  { label: 'Рекомендации', hasValue: (draft) => Boolean(draft.recommendations?.length) },
  { label: 'Достижения', hasValue: (draft) => Boolean(draft.achievements?.length) },
];

export function profileCompleteness(draft: ResumeDraft): ProfileCompleteness {
  const missingSections = PROFILE_BLOCKS.filter((block) => !block.hasValue(draft)).map(
    (block) => block.label,
  );
  return {
    completedCount: PROFILE_BLOCKS.length - missingSections.length,
    totalCount: PROFILE_BLOCKS.length as ProfileCompleteness['totalCount'],
    missingSections,
  };
}
