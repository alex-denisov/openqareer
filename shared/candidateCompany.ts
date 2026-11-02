import type { CandidateRecruiterChannel } from './recruiterChannel';
export type CandidateCompanySort = 'default' | 'contacts' | 'alphabetical';
export type CandidateCompanyFilter = 'all' | 'want' | 'contacts' | 'recruiter';
/** Stage of a company in the candidate's «Хочу» list; mutually exclusive. */
export type CandidateCompanyWantStage = 'want' | 'path' | 'waiting';
export type CandidateCompanyWantStageFilter = 'all' | 'new' | CandidateCompanyWantStage;
export type CandidateCompanyContactsFilter = 'any' | 'with' | 'without';
export type CandidateCompanyWantSort = 'vacancies' | 'alphabetical' | 'added';
export type CandidateLinkedInStatus = 'connected' | 'profile-imported' | 'disconnected';
export type CandidateCompanyRecruiterSearchStatus =
  'idle' | 'queued' | 'running' | 'ready' | 'failed';

export interface CandidateCompanySource {
  readonly name: string;
  readonly observedAt: string;
}

export interface CandidateCompanyVacancy {
  readonly id: string;
  readonly title: string;
  readonly location: string | null;
  readonly sourceName: string;
  readonly sourceDate: string;
  readonly href: string;
}

export interface CandidateCompanyRecruiter {
  readonly id: string;
  readonly companyKey: string;
  readonly vacancyId: string;
  readonly fullName: string;
  readonly roleTitle: string;
  readonly email: string | null;
  readonly emailStatus: 'verified' | 'hypothesis' | 'unverified';
  readonly phone: string | null;
  readonly telegram: string | null;
  readonly whatsapp: string | null;
  readonly linkedinUrl: string | null;
  readonly githubUrl: string | null;
  readonly twitterUrl: string | null;
  readonly source: 'vacancy' | 'public-profile';
  readonly sourceLabel: string;
  readonly sourceDate: string;
  readonly isHypothesis: boolean;
  /** Каналы связи по ценности для кандидата (B258); источник не отдаётся. */
  readonly channels?: readonly CandidateRecruiterChannel[];
}

export interface CandidateCompanyNextStep {
  readonly text: string;
  readonly dueAt: string | null;
}

export interface CandidateCompanyOpportunity {
  readonly key: string;
  readonly name: string;
  readonly location: string | null;
  readonly industry: string | null;
  readonly vacancyCount: number;
  /** Null means no candidate-owned imported contact list can support a count. */
  readonly contactsCount: number | null;
  readonly contactsImportedAt: string | null;
  readonly want: boolean;
  /** B439: the candidate answered «Не сейчас» to the consultant's contact proposal. */
  readonly contactProposalDismissed?: boolean;
  /** Vacancies come from the pool: none of them is in the current selection. */
  readonly outsideSelection?: boolean;
  /** Present for companies in «Хочу»: stored manual stage or the derived one. */
  readonly wantStage?: CandidateCompanyWantStage | null;
  readonly wantedAt?: string | null;
  /** A matched vacancy of this company was observed within the last 7 days. */
  readonly hasNewVacancies?: boolean;
  readonly nextStep: CandidateCompanyNextStep | null;
  readonly hasRecruiter: boolean;
  readonly recruiterSearchStatus: CandidateCompanyRecruiterSearchStatus;
  readonly sources: readonly CandidateCompanySource[];
  readonly vacancies: readonly CandidateCompanyVacancy[];
  readonly recruiters: readonly CandidateCompanyRecruiter[];
}

export interface CandidateCompanyConnectionStatus {
  readonly status: CandidateLinkedInStatus;
  readonly importedAt: string | null;
  /** B439 can report this honestly only after a candidate-owned contact import exists. */
  readonly contactsImported: boolean;
}

export interface CandidateCompanyPage {
  readonly items: readonly CandidateCompanyOpportunity[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly sort: CandidateCompanySort;
  readonly filter: CandidateCompanyFilter;
  readonly filterCounts: {
    readonly all: number;
    readonly want: number;
    readonly contacts: number | null;
    readonly recruiter: number;
  };
  readonly linkedin: CandidateCompanyConnectionStatus;
  readonly searchConsentGranted: boolean;
}

export interface CandidateCompanyWantCounts {
  readonly all: number;
  readonly new: number;
  readonly want: number;
  readonly path: number;
  readonly waiting: number;
}

/** One page of the «Хочу в компанию» list (only companies the candidate wants). */
export interface CandidateCompanyWantPage {
  readonly items: readonly CandidateCompanyOpportunity[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly counts: CandidateCompanyWantCounts;
  readonly industries: readonly string[];
}

/** Compact row for selection by filter, export and bulk actions. */
export interface CandidateCompanyWantSelectionItem {
  readonly key: string;
  readonly name: string;
  readonly industry: string | null;
  readonly stage: CandidateCompanyWantStage;
  readonly vacancyCount: number;
  readonly contactsCount: number | null;
  readonly nextStep: string | null;
}

export interface CandidateCompanyDetails {
  readonly company: CandidateCompanyOpportunity;
  readonly vacancies: readonly CandidateCompanyVacancy[];
  readonly totalVacancies: number;
  readonly vacancyOffset: number;
  readonly nextOffset: number | null;
}
