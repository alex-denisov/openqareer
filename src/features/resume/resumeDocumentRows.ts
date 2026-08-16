import type {
  ResumeDocument,
  ResumeDraft,
  ResumeEducation,
  ResumeExperience,
  ResumeLanguage,
} from './resumeTypes';

export interface ResumeExperienceRow {
  readonly entry: ResumeDraft['experience'][number];
  readonly projected?: ResumeExperience;
}

/**
 * Renders in the order the engine projected, then appends the draft entries the
 * engine refused. Two reasons, both user-visible: the German variant is reverse
 * chronological, and an entry whose evidence stopped being eligible vanishes
 * from the document — it must stay editable instead of becoming an orphan the
 * candidate can neither see nor delete.
 */
export function mergeExperience(
  draft: ResumeDraft,
  document: ResumeDocument,
): readonly ResumeExperienceRow[] {
  const byId = new Map(draft.experience.map((entry) => [entry.id, entry]));
  const projectedIds = new Set(document.experience.map((entry) => entry.id));
  return [
    ...document.experience.map((projected) => ({
      entry: byId.get(projected.id) ?? experienceFromProjection(projected),
      projected,
    })),
    ...draft.experience
      .filter((entry) => !projectedIds.has(entry.id))
      .map((entry) => ({ entry })),
  ];
}

export function mergeEducation(
  draft: ResumeDraft,
  document: ResumeDocument,
): ReadonlyArray<ResumeDraft['education'][number]> {
  const byId = new Map(draft.education.map((entry) => [entry.id, entry]));
  const projectedIds = new Set(document.education.map((entry) => entry.id));
  return [
    ...document.education.map(
      (projected) => byId.get(projected.id) ?? educationFromProjection(projected),
    ),
    ...draft.education.filter((entry) => !projectedIds.has(entry.id)),
  ];
}

export function mergeLanguages(
  draft: ResumeDraft,
  document: ResumeDocument,
): ReadonlyArray<ResumeDraft['languages'][number]> {
  const byId = new Map(draft.languages.map((entry) => [entry.id, entry]));
  const projectedIds = new Set(document.languages.map((entry) => entry.id));
  return [
    ...document.languages.map(
      (projected) => byId.get(projected.id) ?? languageFromProjection(projected),
    ),
    ...draft.languages.filter((entry) => !projectedIds.has(entry.id)),
  ];
}

/** Every memory id the draft already spends, so a picker never offers it twice. */
export function usedEvidenceIds(draft: ResumeDraft): ReadonlySet<string> {
  return new Set([
    ...draft.experience.map((entry) => entry.chronologyMemoryId),
    ...draft.experience.flatMap((entry) => entry.bulletMemoryIds),
    ...draft.education.map((entry) => entry.evidenceMemoryId),
    ...draft.languages.map((entry) => entry.evidenceMemoryId),
  ]);
}

function experienceFromProjection(
  projected: ResumeExperience,
): ResumeDraft['experience'][number] {
  return {
    id: projected.id,
    chronologyMemoryId: projected.current.memoryId,
    title: projected.title?.value,
    employer: projected.employer?.value,
    location: projected.location?.value,
    startDate: projected.startDate?.value,
    endDate: projected.endDate?.value,
    current: projected.current.value,
    bulletMemoryIds: projected.bullets.map((bullet) => bullet.memoryId),
  };
}

function educationFromProjection(
  projected: ResumeEducation,
): ResumeDraft['education'][number] {
  return {
    id: projected.id,
    evidenceMemoryId:
      projected.institution?.memoryId ?? projected.qualification?.memoryId ?? '',
    institution: projected.institution?.value,
    qualification: projected.qualification?.value,
    startDate: projected.startDate?.value,
    endDate: projected.endDate?.value,
  };
}

function languageFromProjection(
  projected: ResumeLanguage,
): ResumeDraft['languages'][number] {
  return {
    id: projected.id,
    evidenceMemoryId: projected.name?.memoryId ?? projected.cefr?.memoryId ?? '',
    name: projected.name?.value,
    cefr: projected.cefr?.value,
  };
}
