/** Percentages describe verified requirement coverage, never hiring probability. */
import type { VacancyRequirement } from '../server/domain/vacancyRequirements';
export interface VacancyFitView {
  /** `refreshing`: `result` is from an earlier algorithm version, the new one is queued (B562-r). */
  readonly state:
    | 'not_requested'
    | 'processing'
    | 'retrying'
    | 'refreshing'
    | 'ready'
    | 'no_description'
    | 'no_requirements'
    | 'failed';
  readonly requirements: readonly VacancyRequirement[];
  readonly result?: VacancyFitResult;
  /** Why a `failed` job stopped, from its error class; the row names it instead of «try again». */
  readonly failure?: VacancyFitFailure;
  /** 02.11: hh answered «работодатель ограничил доступ» twice; no text, so no percent. */
  readonly textHidden?: true;
  /** List payload only: requirement text and verdict, no quotes, so the card lists match the percent. */
  readonly points?: readonly VacancyFitPoint[];
}
export interface VacancyFitPoint {
  readonly text: string;
  readonly status: VacancyFitRequirementAssessment['status'];
}
export type VacancyFitFailure =
  'model_unavailable' | 'model_invalid' | 'requirements' | 'profile_changed' | 'other';
/** 02.11 audit: no per-quote cap, adjacent area unknown, location evidence only for location conditions, job-board soft-skill tags dropped. */
export const VACANCY_FIT_ALGORITHM_VERSION = 'evidence-coverage-9';
/** Shown while the current version is calculated, so a version bump never hides a known percent. */
export const LEGACY_VACANCY_FIT_ALGORITHM_VERSIONS: readonly string[] = [
  'evidence-coverage-8',
  'evidence-coverage-7',
  'evidence-coverage-6',
  'evidence-coverage-5',
  'evidence-coverage-4',
  'evidence-coverage-3',
  'evidence-coverage-2',
];
export const VACANCY_FIT_GATE_NAMES = [
  'role',
  'level',
  'region',
  'workAuthorization',
  'workFormat',
] as const;
export type VacancyFitGateName = (typeof VACANCY_FIT_GATE_NAMES)[number];
export type VacancyFitGateStatus = 'matched' | 'blocked' | 'unknown';
export interface VacancyFitEvidence {
  readonly factId: string;
  readonly quote: string;
}
export interface VacancyFitGate {
  readonly status: VacancyFitGateStatus;
  readonly reason: string;
  readonly evidence?: readonly VacancyFitEvidence[];
}
export type VacancyFitGates = Readonly<Record<VacancyFitGateName, VacancyFitGate>>;
export interface VacancyFitRequirementAssessment {
  readonly requirementId: string;
  /** `partial`: the evidence covers part of the requirement (01.11), counted half. */
  readonly status: 'matched' | 'partial' | 'unmatched' | 'unknown';
  readonly evidence: readonly VacancyFitEvidence[];
  /** Verification label only (01.11): matched by a fact a skill check wrote. It no longer changes the credit. */
  readonly checked?: boolean;
}
export interface VacancyFitConditionBlock { readonly requirementId: string; readonly text: string; readonly quote: string }
export interface VacancyFitResult {
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly algorithmVersion: string;
  readonly status: 'assessed' | 'blocked' | 'unknown';
  readonly calculatedAt: string;
  readonly dataState: 'confirmed' | 'partial' | 'unknown';
  readonly gates: VacancyFitGates;
  readonly coveragePercent: number | null;
  readonly requiredCoverage: {
    readonly matched: number;
    readonly total: number;
    readonly percent: number | null;
  };
  /** Skill requirements only (B510-r): conditions such as education or language never make the percent. */
  readonly coverage: {
    readonly matched: number;
    readonly total: number;
    readonly unknown: number;
    readonly checked?: number;
    readonly partial?: number;
  };
  /** Conditions (education, language, licence, format, work permit), listed apart from the percent. */
  readonly conditionCoverage?: {
    readonly matched: number;
    readonly total: number;
    readonly unknown: number;
    readonly checked?: number;
    readonly partial?: number;
  };
  readonly assessments: readonly VacancyFitRequirementAssessment[];
  /**
   * 03.11: soft skills the profile's experience implies (a leading role, work with clients). Counted
   * as met in the percent; the stored assessments stay as the model gave them, so no model call repeats.
   */
  readonly implied?: readonly { readonly requirementId: string; readonly role: string }[];
  /**
   * 03.11: location lines (an onsite city, a format) the search conditions cover. Met whatever the
   * profile city says; the stored assessments stay as the model gave them, like `implied`.
   */
  readonly placeCovered?: readonly string[];
  /** 02.11: work authorisation or country-restricted remote a quoted profile fact contradicts. */
  readonly conditionBlocks?: readonly VacancyFitConditionBlock[];
  readonly reason:
    | 'assessed'
    | 'blocked_gate'
    | 'unknown_gate'
    | 'no_requirements'
    | 'no_eligible_facts'
    | 'assessment_unavailable'
    | 'too_few_skills';
}
