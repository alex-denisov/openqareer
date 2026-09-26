/**
 * The Resume Studio wire contract.
 *
 * Types are imported from the server domain rather than re-declared: a hand
 * copied mirror drifts, and a drifting resume contract means the interface can
 * promise a claim the engine refuses to project. `import type` is erased at
 * build time, so no server code reaches the browser bundle.
 */
export type {
  CefrLevel,
  ResumeAssertion,
  ResumeConventions,
  ResumeDocument,
  ResumeDraft,
  ResumeEducation,
  ResumeEvidenceFreshness,
  ResumeExperience,
  ResumeLanguage,
  ResumeReviewFlag,
  ResumeStudioProjection,
  ResumeUnknown,
  StaleEvidenceReason,
} from '../../../server/domain/resumeStudio';
export type { ResumeUnknownCode } from '../../../server/domain/resumeStudioTypes';

export type {
  ResumeAchievementInput,
  ResumeAchievementKind,
  ResumeCertificationInput,
  ResumeCourseInput,
  ResumeEducationInput,
  ResumeExperienceInput,
  ResumeLanguageInput,
  ResumeProjectInput,
  ResumeRecommendationInput,
  ResumeSkillInput,
} from '../../../server/domain/resumeDraft';

import type { ResumeDraft } from '../../../server/domain/resumeDraft';
import type {
  ResumeEvidenceFreshness,
  ResumeStudioProjection,
} from '../../../server/domain/resumeStudio';
export type { ResumeReaderProvenance } from '../../../server/data/candidateStore';
import type { ResumeReaderProvenance } from '../../../server/data/candidateStore';

/** Response body of `GET`/`PUT /api/v1/candidate/resume`. */
export interface ResumeStudioView {
  readonly draft: ResumeDraft | null;
  readonly savedAt: { readonly createdAt: string; readonly updatedAt: string } | null;
  readonly projection: ResumeStudioProjection;
  readonly evidenceFreshness: ResumeEvidenceFreshness;
  readonly reader?: ResumeReaderProvenance | null;
}

export type ResumeVariantId = 'master' | 'germany';

export type ResumeFormatMode = 'stanford-pdf' | 'ats-text' | 'linkedin-pack';
