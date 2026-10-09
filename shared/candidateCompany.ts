export type CandidateCompanySort = 'default' | 'contacts' | 'alphabetical';
export type CandidateCompanyFilter = 'all' | 'want' | 'contacts' | 'recruiter';
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
  readonly contactsImported: false;
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

export interface CandidateCompanyDetails {
  readonly company: CandidateCompanyOpportunity;
  readonly vacancies: readonly CandidateCompanyVacancy[];
  readonly totalVacancies: number;
  readonly vacancyOffset: number;
  readonly nextOffset: number | null;
}
