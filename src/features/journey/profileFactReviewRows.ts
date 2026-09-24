import type {
  ParsedResumeEducation,
  ParsedResumeExperience,
} from '../workspace/resumeParserTypes';

const HAS_DIGIT = /\d/;

/**
 * Live counts for the "разбираем резюме" screen (onboarding.html step 2a):
 * the mockup shows real numbers ("6 мест работы", "16 из 27 пунктов с
 * числом"), not a spinner with no content.
 */
export interface ParseProgressCounts {
  readonly jobCount: number;
  readonly hasEducation: boolean;
  readonly hasSkills: boolean;
  readonly totalBullets: number;
  readonly bulletsWithNumber: number;
}

export function buildParseProgressCounts(input: {
  readonly experience: readonly ParsedResumeExperience[];
  readonly education: readonly ParsedResumeEducation[];
  readonly skills: readonly string[];
}): ParseProgressCounts {
  const bullets = input.experience.flatMap((job) => [
    ...job.responsibilities,
    ...job.achievements,
  ]);
  return {
    jobCount: input.experience.length,
    hasEducation: input.education.length > 0,
    hasSkills: input.skills.length > 0,
    totalBullets: bullets.length,
    bulletsWithNumber: bullets.filter((bullet) => HAS_DIGIT.test(bullet)).length,
  };
}

export type ProfileReviewTagTone = 'success' | 'warning';

export interface ProfileReviewTag {
  readonly tone: ProfileReviewTagTone;
  readonly label: string;
}

export interface ProfileReviewRow {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly tag?: ProfileReviewTag;
}

function jobDateRange(job: ParsedResumeExperience): string {
  const start = job.startDate ?? '';
  const end = job.current ? 'наст. время' : (job.endDate ?? '');
  return [start, end].filter(Boolean).join(' — ');
}

function numericEvidenceTag(job: ParsedResumeExperience): ProfileReviewTag | undefined {
  const bullets = [...job.responsibilities, ...job.achievements];
  if (bullets.length === 0) return undefined;
  const withNumber = bullets.filter((bullet) => HAS_DIGIT.test(bullet)).length;
  if (withNumber === bullets.length) {
    return { tone: 'success', label: 'Результаты в цифрах' };
  }
  // Matches the mockup's own copy verbatim ("1 из 4 пунктов с числом");
  // "пунктов" stays invariant rather than agreeing with the total, same as
  // onboarding.html step 3.
  return {
    tone: 'warning',
    label: `${withNumber} из ${bullets.length} пунктов с числом`,
  };
}

/**
 * One row per job, plus an optional geography/format row — exactly the shape
 * of "Проверьте профиль" (onboarding.html step 3). Every row names its
 * source, because a fact the candidate never confirmed still reaches emails
 * and matching (mockup-data-gap.md, "Онбординг" §3).
 */
export function buildProfileReviewRows(input: {
  readonly experience: readonly ParsedResumeExperience[];
  readonly sourceLabel: string;
  readonly geoSummary?: string;
  readonly geoSourceLabel?: string;
}): ProfileReviewRow[] {
  const jobRows: ProfileReviewRow[] = input.experience.map((job, index) => ({
    id: `job-${index}`,
    title: `${job.title} · ${job.employer}`,
    subtitle: [jobDateRange(job), input.sourceLabel].filter(Boolean).join(' · '),
    tag: numericEvidenceTag(job),
  }));
  if (!input.geoSummary) return jobRows;
  return [
    ...jobRows,
    {
      id: 'geo',
      title: input.geoSummary,
      subtitle: ['география и формат', input.geoSourceLabel].filter(Boolean).join(' · '),
    },
  ];
}
