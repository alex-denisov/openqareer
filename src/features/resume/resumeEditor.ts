import type { ResumeDocumentEditor } from './ResumeDocumentView';
import {
  addCourse,
  addEducation,
  addExperience,
  addLanguage,
  addRecommendation,
  addSkill,
  addTest,
  removeCourse,
  removeEducation,
  removeExperience,
  removeLanguage,
  removeRecommendation,
  removeSkill,
  removeTest,
  setTargetRole,
  toggleBullet,
  updateCandidate,
  updateEducation,
  updateExperience,
  updateLanguage,
} from './resumeStudioModel';
import type { ResumeDraft } from './resumeTypes';

/**
 * Binds the immutable draft operations to a change sink. Kept out of the
 * component so the surface stays about layout and the rules stay testable.
 */
export function buildResumeEditor(
  draft: ResumeDraft,
  onChange: (next: ResumeDraft) => void,
): ResumeDocumentEditor {
  return {
    onCandidate: (patch) => onChange(updateCandidate(draft, patch)),
    onTargetRole: (value) => onChange(setTargetRole(draft, value)),
    onAddExperience: (memoryId) => onChange(addExperience(draft, memoryId)),
    onExperience: (id, patch) => onChange(updateExperience(draft, id, patch)),
    onRemoveExperience: (id) => onChange(removeExperience(draft, id)),
    onToggleBullet: (experienceId, memoryId) =>
      onChange(toggleBullet(draft, experienceId, memoryId)),
    onAddSkill: (name, level) => onChange(addSkill(draft, name, level)),
    onRemoveSkill: (id) => onChange(removeSkill(draft, id)),
    onAddCourse: (name, institution, year) =>
      onChange(addCourse(draft, name, institution, year)),
    onRemoveCourse: (id) => onChange(removeCourse(draft, id)),
    onAddTest: (name, provider, score) =>
      onChange(addTest(draft, name, provider, score)),
    onRemoveTest: (id) => onChange(removeTest(draft, id)),
    onAddRecommendation: (recommender, organization) =>
      onChange(addRecommendation(draft, recommender, organization)),
    onRemoveRecommendation: (id) => onChange(removeRecommendation(draft, id)),
    onAddEducation: (memoryId) => onChange(addEducation(draft, memoryId)),
    onEducation: (id, patch) => onChange(updateEducation(draft, id, patch)),
    onRemoveEducation: (id) => onChange(removeEducation(draft, id)),
    onAddLanguage: (memoryId) => onChange(addLanguage(draft, memoryId)),
    onLanguage: (id, patch) => onChange(updateLanguage(draft, id, patch)),
    onRemoveLanguage: (id) => onChange(removeLanguage(draft, id)),
  };
}
