import type { TaxDataSource } from '../taxData/types';
import type { GermanOpportunityCardProfile } from './germanyOpportunityCard';

export const MOBILITY_SCENARIO_IDS = [
  'domestic_market',
  'employer_sponsorship',
  'job_seeker_visa',
  'digital_nomad',
  'simple_mobility',
] as const;

export type MobilityScenarioId = (typeof MOBILITY_SCENARIO_IDS)[number];
export type ScenarioAvailability = 'available' | 'barriers' | 'unknown' | 'unavailable';
export type CountryFitStatus = 'available' | 'high_barriers' | 'legally_unavailable' | 'unknown';

export interface CandidateAmount {
  readonly amount: number;
  readonly currency: string;
}

interface SourcedRequirement {
  readonly source: TaxDataSource;
  readonly explanation: string;
}

export type MobilityRequirement =
  | { readonly kind: 'domestic_right'; readonly countryCode: string }
  | {
      readonly kind: 'regional_work_right';
      readonly destinationCountryCodes: readonly string[];
      readonly eligibleCitizenshipCountryCodes: readonly string[];
      readonly source: TaxDataSource;
      readonly explanation: string;
    }
  | ({ readonly kind: 'job_offer' } & SourcedRequirement)
  | ({ readonly kind: 'approved_sponsor' } & SourcedRequirement)
  | ({ readonly kind: 'occupation_eligible' } & SourcedRequirement)
  | ({ readonly kind: 'going_rate_met' } & SourcedRequirement)
  | ({ readonly kind: 'recognized_degree' } & SourcedRequirement)
  | ({ readonly kind: 'completed_qualification' } & SourcedRequirement)
  | ({ readonly kind: 'blue_card_exception_eligible' } & SourcedRequirement)
  | ({ readonly kind: 'it_professional' } & SourcedRequirement)
  | ({ readonly kind: 'meets_language_requirements' } & SourcedRequirement)
  | ({ readonly kind: 'bachelor_degree' } & SourcedRequirement)
  | ({ readonly kind: 'job_seeker_category' } & SourcedRequirement)
  | ({ readonly kind: 'recent_top_university_graduate'; readonly amount: number } & SourcedRequirement)
  | ({ readonly kind: 'financial_guarantee' } & SourcedRequirement)
  | ({ readonly kind: 'minimum_annual_salary'; readonly amount: number; readonly currency: string } & SourcedRequirement)
  | ({
      readonly kind: 'minimum_offer_salary';
      readonly amount: number;
      readonly currency: string;
      /** The pay period the official threshold is stated for. */
      readonly per: 'month' | 'quarter';
    } & SourcedRequirement)
  | ({ readonly kind: 'minimum_savings'; readonly amount: number; readonly currency: string } & SourcedRequirement)
  | ({ readonly kind: 'minimum_job_seeker_points'; readonly amount: number } & SourcedRequirement)
  | ({ readonly kind: 'minimum_monthly_funds'; readonly amount: number; readonly currency: string } & SourcedRequirement)
  | ({
      readonly kind: 'minimum_remote_income';
      readonly amount: number;
      readonly currency: string;
      readonly incomeBasis: 'net' | 'gross' | 'unspecified';
      readonly partnerUplift?: number;
      readonly childUplift?: number;
    } & SourcedRequirement)
  | ({ readonly kind: 'foreign_remote_employment' } & SourcedRequirement)
  | ({ readonly kind: 'private_health_insurance' } & SourcedRequirement)
  | ({ readonly kind: 'minimum_experience_years'; readonly amount: number; readonly withinYears?: number } & SourcedRequirement)
  | {
      readonly kind: 'visa_free_stay';
      /** Only citizenships checked on the official list; others stay unknown, never rejected. */
      readonly eligibleCitizenshipCountryCodes: readonly string[];
      readonly maximumStayDays: number;
      readonly source: TaxDataSource;
      readonly explanation: string;
    }
  /** A sourced condition the questionnaire does not collect; it keeps the path unknown. */
  | ({ readonly kind: 'manual_check' } & SourcedRequirement)
  | ({
      readonly kind: 'work_authorization';
      readonly shortTermExceptionMaximumDays?: number;
    } & SourcedRequirement);

export interface MobilityPath {
  readonly id: string;
  readonly label: string;
  readonly requirements: readonly MobilityRequirement[];
}

export interface MobilityScenarioDefinition {
  readonly id: MobilityScenarioId;
  readonly label: string;
  readonly dataStatus: 'verified' | 'no_data' | 'unavailable';
  readonly paths: readonly MobilityPath[];
  readonly reason?: string;
  /** Official sources behind an `unavailable` answer. */
  readonly sources?: readonly TaxDataSource[];
}

export interface CountryMobilityData {
  readonly countryCode: string;
  readonly name: string;
  readonly scenarios: readonly MobilityScenarioDefinition[];
}

export interface MobilityResidenceDocument {
  readonly kind: 'residence_permit' | 'work_permit' | 'work_visa' | 'study_visa' | 'visa' | 'other';
  readonly countryCode: string;
  readonly expiresAt?: string;
}

export interface MobilityCandidateProfile {
  readonly citizenshipCountryCodes?: readonly string[];
  /** Documents from the questionnaire; a valid permit is a residence right in its country. */
  readonly residenceDocuments?: readonly MobilityResidenceDocument[];
  /** The candidate's local date (YYYY-MM-DD) that document expiry is checked against. */
  readonly asOf?: string;
  readonly currentCountryCode?: string;
  readonly hasJobOffer?: boolean;
  readonly approvedEmployerSponsor?: boolean;
  readonly occupationEligible?: boolean;
  readonly occupationGoingRateMet?: boolean;
  readonly annualOfferSalary?: CandidateAmount;
  readonly monthlyOfferSalary?: CandidateAmount;
  readonly availableSavings?: CandidateAmount;
  readonly recognizedDegreeCountryCodes?: readonly string[];
  readonly completedFormalQualification?: boolean;
  readonly blueCardExceptionEligible?: boolean;
  readonly isItProfessional?: boolean;
  readonly meetsLanguageRequirementsByCountry?: Readonly<Record<string, boolean>>;
  readonly hasBachelorDegree?: boolean;
  readonly jobSeekerCategoryEligibleByCountry?: Readonly<Record<string, boolean>>;
  readonly recentTopUniversityGraduateWithinYearsByCountry?: Readonly<Record<string, number>>;
  readonly financialGuaranteeSatisfiedByCountry?: readonly string[];
  readonly germanyOpportunityCard?: GermanOpportunityCardProfile;
  readonly minimumMonthlyFunds?: CandidateAmount;
  readonly remoteMonthlyIncome?: CandidateAmount;
  readonly remoteMonthlyIncomeIsNet?: boolean;
  readonly worksRemotelyForForeignEmployer?: boolean;
  readonly hasPrivateHealthInsurance?: boolean;
  readonly relevantExperienceYears?: number;
  readonly relevantExperienceYearsByWindow?: Readonly<Record<string, number>>;
  readonly hasLocalWorkAuthorizationCountryCodes?: readonly string[];
  readonly shortTermWorkExceptionByCountry?: Readonly<Record<string, boolean>>;
  readonly stayDurationDays?: number;
  readonly family?: { readonly hasPartner: boolean; readonly children: number };
}

export interface SourcedThreshold {
  readonly requirement: MobilityRequirement['kind'];
  readonly label: string;
  readonly amount: number;
  readonly currency?: string;
  readonly period: 'annual' | 'quarterly' | 'monthly' | 'one_time' | 'points' | 'years';
  readonly source: TaxDataSource;
}

export interface MobilityPathEvaluation {
  readonly id: string;
  readonly label: string;
  readonly status: ScenarioAvailability;
  readonly reasons: readonly string[];
  readonly thresholds: readonly SourcedThreshold[];
  readonly sources: readonly TaxDataSource[];
}

export interface MobilityScenarioEvaluation {
  readonly id: MobilityScenarioId;
  readonly label: string;
  readonly status: ScenarioAvailability;
  readonly reasons: readonly string[];
  readonly thresholds: readonly SourcedThreshold[];
  readonly sources: readonly TaxDataSource[];
  readonly paths: readonly MobilityPathEvaluation[];
}

export interface CountryFitEvaluation {
  readonly countryCode: string;
  readonly countryName: string;
  readonly status: CountryFitStatus;
  readonly scenarios: readonly MobilityScenarioEvaluation[];
}
