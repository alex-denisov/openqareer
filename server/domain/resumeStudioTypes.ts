import type {
  CefrLevel,
  ResumeAdditionalInput,
  ResumeCourseInput,
  ResumeDraft,
  ResumeRecommendationInput,
  ResumeSkillInput,
  ResumeTestInput,
} from './resumeDraft';

export type { CefrLevel, ResumeDraft } from './resumeDraft';

type ResumeMemoryStatus = 'proposed' | 'confirmed' | 'corrected';
type ResumeMemoryKind =
  | 'fact'
  | 'preference'
  | 'hypothesis'
  | 'open-question';

export interface ResumeEvidence {
  readonly id: string;
  readonly kind: ResumeMemoryKind;
  readonly status: ResumeMemoryStatus;
  readonly statement: string;
  readonly sourceMessageIds: readonly string[];
  readonly sensitive: boolean;
}

export interface ResumeStudioInput extends ResumeDraft {
  readonly evidence: readonly ResumeEvidence[];
}

export type ResumeReviewFlag =
  'quantitative-claim-needs-substantiation';

export interface ResumeAssertion<T extends string | boolean = string> {
  readonly value: T;
  readonly memoryId: string;
  readonly sourceMessageIds: readonly string[];
  readonly reviewFlags: readonly ResumeReviewFlag[];
}

export interface ResumeExperience {
  readonly id: string;
  readonly title: ResumeAssertion | null;
  readonly employer: ResumeAssertion | null;
  readonly location: ResumeAssertion | null;
  readonly startDate: ResumeAssertion | null;
  readonly endDate: ResumeAssertion | null;
  readonly current: ResumeAssertion<boolean>;
  readonly bullets: readonly ResumeAssertion[];
}

export interface ResumeEducation {
  readonly id: string;
  readonly institution: ResumeAssertion | null;
  readonly qualification: ResumeAssertion | null;
  readonly startDate: ResumeAssertion | null;
  readonly endDate: ResumeAssertion | null;
}

export interface ResumeLanguage {
  readonly id: string;
  readonly name: ResumeAssertion | null;
  readonly cefr: ResumeAssertion<CefrLevel> | null;
}

export type ResumeUnknownCode =
  | 'missing-full-name'
  | 'missing-contact'
  | 'missing-target-role'
  | 'missing-role-chronology'
  | 'missing-role-title'
  | 'missing-employer'
  | 'missing-role-start-date'
  | 'missing-role-end-date'
  | 'missing-role-claims'
  | 'missing-education'
  | 'missing-education-details'
  | 'missing-language-name'
  | 'missing-language-level'
  | 'chronology-conflict'
  | 'invalid-chronology-date'
  | 'ineligible-evidence'
  | 'germany-bullet-count'
  | 'germany-length-exceeds-two-pages';

export interface ResumeUnknown {
  readonly code: ResumeUnknownCode;
  readonly message: string;
  readonly scope: 'both' | 'DE';
  readonly blocking: boolean;
  readonly entryId?: string;
  readonly memoryId?: string;
}

export interface ResumeConventions {
  readonly country: 'DE' | null;
  readonly packVersion: 'DE-CV-2026.1' | null;
  readonly reverseChronological: boolean;
  readonly maxPages: 2 | null;
  readonly recommendedBulletsPerRole: { readonly min: 3; readonly max: 5 } | null;
  readonly photo: 'omitted';
  readonly discriminatoryPii: 'omitted';
}

export interface ResumeContact {
  readonly fullName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly telegram?: string | null;
  readonly location: string | null;
  readonly links: readonly string[];
}

export interface ResumeLengthEstimate {
  readonly lines: number;
  readonly pages: number;
  readonly linesPerPage: number;
}

export interface ResumeDocument {
  readonly kind: 'master' | 'country-role';
  readonly targetRole: string | null;
  readonly contact: ResumeContact;
  readonly about?: string | null;
  readonly photoUrl?: string | null;
  readonly experience: readonly ResumeExperience[];
  readonly skills?: readonly ResumeSkillInput[];
  readonly education: readonly ResumeEducation[];
  readonly courses?: readonly ResumeCourseInput[];
  readonly tests?: readonly ResumeTestInput[];
  readonly recommendations?: readonly ResumeRecommendationInput[];
  readonly languages: readonly ResumeLanguage[];
  readonly additional?: ResumeAdditionalInput | null;
  readonly unknowns: readonly ResumeUnknown[];
  readonly conventions: ResumeConventions;
  readonly length: ResumeLengthEstimate;
}

export interface ResumeEvidenceSnapshot {
  readonly memoryId: string;
  readonly statement: string;
  readonly sourceMessageIds: readonly string[];
}

export interface ResumeStudioProjection {
  readonly master: ResumeDocument;
  readonly germanyVariant: ResumeDocument;
  readonly evidenceSnapshot: readonly ResumeEvidenceSnapshot[];
  readonly excludedEvidenceIds: readonly string[];
}

export type StaleEvidenceReason =
  | 'missing'
  | 'duplicate-current-evidence'
  | 'no-longer-confirmed'
  | 'became-sensitive'
  | 'became-non-factual'
  | 'statement-changed'
  | 'provenance-changed';

export interface ResumeEvidenceFreshness {
  readonly valid: boolean;
  readonly stale: ReadonlyArray<{
    readonly memoryId: string;
    readonly reasons: readonly StaleEvidenceReason[];
  }>;
}

export interface NormalizedEvidence {
  readonly id: string;
  readonly statement: string;
  readonly sourceMessageIds: readonly string[];
  readonly kind: ResumeMemoryKind;
  readonly status: ResumeMemoryStatus;
  readonly sensitive: boolean;
}

export interface EvidenceCatalog {
  readonly eligible: ReadonlyMap<string, NormalizedEvidence>;
  readonly duplicateIds: ReadonlySet<string>;
}

export interface ProjectionContext {
  readonly catalog: EvidenceCatalog;
  readonly usedEvidenceIds: Set<string>;
  readonly excludedEvidenceIds: Set<string>;
  readonly unknowns: ResumeUnknown[];
}
