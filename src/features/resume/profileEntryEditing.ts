import type {
  ResumeAchievementInput,
  ResumeAchievementKind,
  ResumeCertificationInput,
  ResumeCourseInput,
  ResumeDraft,
  ResumeProjectInput,
  ResumeRecommendationInput,
} from './resumeTypes';

/**
 * Entry ids are opaque locals, not evidence memory ids — these three entity
 * types (certifications, projects, achievements) carry no dossier evidence,
 * unlike experience/education/languages (architecture: `resumeDraft.ts`
 * marks their `evidenceMemoryId` optional for exactly this reason).
 */
function localId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function updateAbout(draft: ResumeDraft, about: string): ResumeDraft {
  return { ...draft, candidate: { ...draft.candidate, about } };
}

export function addCertification(draft: ResumeDraft): ResumeDraft {
  const entry: ResumeCertificationInput = { id: localId('cert'), name: '' };
  return { ...draft, certifications: [...(draft.certifications ?? []), entry] };
}

export function updateCertification(
  draft: ResumeDraft,
  id: string,
  patch: Partial<Omit<ResumeCertificationInput, 'id'>>,
): ResumeDraft {
  return {
    ...draft,
    certifications: (draft.certifications ?? []).map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    ),
  };
}

export function removeCertification(draft: ResumeDraft, id: string): ResumeDraft {
  return {
    ...draft,
    certifications: (draft.certifications ?? []).filter((entry) => entry.id !== id),
  };
}

export function addProject(draft: ResumeDraft): ResumeDraft {
  const entry: ResumeProjectInput = { id: localId('project'), name: '' };
  return { ...draft, projects: [...(draft.projects ?? []), entry] };
}

export function updateProject(
  draft: ResumeDraft,
  id: string,
  patch: Partial<Omit<ResumeProjectInput, 'id'>>,
): ResumeDraft {
  return {
    ...draft,
    projects: (draft.projects ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  };
}

export function removeProject(draft: ResumeDraft, id: string): ResumeDraft {
  return { ...draft, projects: (draft.projects ?? []).filter((entry) => entry.id !== id) };
}

export function addAchievement(
  draft: ResumeDraft,
  kind: ResumeAchievementKind = 'honor',
): ResumeDraft {
  const entry: ResumeAchievementInput = { id: localId('achievement'), kind, title: '' };
  return { ...draft, achievements: [...(draft.achievements ?? []), entry] };
}

export function updateAchievement(
  draft: ResumeDraft,
  id: string,
  patch: Partial<Omit<ResumeAchievementInput, 'id'>>,
): ResumeDraft {
  return {
    ...draft,
    achievements: (draft.achievements ?? []).map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    ),
  };
}

export function removeAchievement(draft: ResumeDraft, id: string): ResumeDraft {
  return { ...draft, achievements: (draft.achievements ?? []).filter((entry) => entry.id !== id) };
}

export function updateCourse(
  draft: ResumeDraft,
  id: string,
  patch: Partial<Omit<ResumeCourseInput, 'id'>>,
): ResumeDraft {
  return {
    ...draft,
    courses: (draft.courses ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  };
}

export function updateRecommendation(
  draft: ResumeDraft,
  id: string,
  patch: Partial<Omit<ResumeRecommendationInput, 'id'>>,
): ResumeDraft {
  return {
    ...draft,
    recommendations: (draft.recommendations ?? []).map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    ),
  };
}
