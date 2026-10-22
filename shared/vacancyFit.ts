/** Percentages describe verified requirement coverage, never hiring probability. */
import type { VacancyRequirement } from '../server/domain/vacancyRequirements';
export interface VacancyFitView {
  readonly state: 'not_requested' | 'processing' | 'retrying' | 'ready' | 'no_description' | 'no_requirements' | 'failed';
  readonly requirements: readonly VacancyRequirement[];
  readonly result?: VacancyFitResult;
}
export const VACANCY_FIT_ALGORITHM_VERSION = 'evidence-coverage-2';
export const VACANCY_FIT_GATE_NAMES = ['role', 'level', 'region', 'workAuthorization', 'workFormat'] as const;
export type VacancyFitGateName = typeof VACANCY_FIT_GATE_NAMES[number];
export type VacancyFitGateStatus = 'matched' | 'blocked' | 'unknown';
export interface VacancyFitEvidence { readonly factId: string; readonly quote: string }
export interface VacancyFitGate {
  readonly status: VacancyFitGateStatus;
  readonly reason: string;
  readonly evidence?: readonly VacancyFitEvidence[];
}
export type VacancyFitGates = Readonly<Record<VacancyFitGateName, VacancyFitGate>>;
export interface VacancyFitRequirementAssessment {
  readonly requirementId: string;
  readonly status: 'matched' | 'unmatched' | 'unknown';
  readonly evidence: readonly VacancyFitEvidence[];
}
export interface VacancyFitResult {
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly algorithmVersion: string;
  readonly status: 'assessed' | 'blocked' | 'unknown';
  readonly calculatedAt: string;
  readonly dataState: 'confirmed' | 'partial' | 'unknown';
  readonly gates: VacancyFitGates;
  readonly coveragePercent: number | null;
  readonly requiredCoverage: { readonly matched: number; readonly total: number; readonly percent: number | null };
  /** Skill requirements only (B510-r): conditions such as education or language never make the percent. */
  readonly coverage: { readonly matched: number; readonly total: number; readonly unknown: number };
  /** Conditions (education, language, licence, format, work permit), listed apart from the percent. */
  readonly conditionCoverage?: { readonly matched: number; readonly total: number; readonly unknown: number };
  readonly assessments: readonly VacancyFitRequirementAssessment[];
  readonly reason: 'assessed' | 'blocked_gate' | 'unknown_gate' | 'no_requirements' | 'no_eligible_facts' | 'assessment_unavailable' | 'too_few_skills';
}
