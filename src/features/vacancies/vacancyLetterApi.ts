import { apiFetch, readData } from '../coach/apiClient';
export type LetterLanguage = 'ru' | 'en';
export type LetterTone = 'executive' | 'confident' | 'technical';

export type ConnectionCircleNumber = 1 | 2 | 3;
export type ConnectionCircleState = 'available' | 'none' | 'unknown';
export type ConnectionCircleStrength = 'direct' | 'strong' | 'weak' | 'unknown';
export type ConnectionCircleSource = 'manual' | 'linkedin_import' | 'work_history' | 'cold';
export type ConnectionCircleNextStep =
  | 'write_known_contact'
  | 'ask_for_introduction'
  | 'cold_application';

export interface ConnectionCircleWorkplace {
  readonly companyName: string;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export interface ConnectionCirclePerson {
  readonly id: string;
  readonly fullName: string;
  readonly roleTitle: string | null;
  readonly companyName: string | null;
  readonly linkedinUrl?: string | null;
  readonly workplaces?: readonly ConnectionCircleWorkplace[];
}

export interface ConnectionCirclePath {
  readonly id: string;
  readonly circle: ConnectionCircleNumber;
  readonly path: readonly ConnectionCirclePerson[];
  readonly recipient: ConnectionCirclePerson;
  readonly evidence: readonly string[];
  readonly strength: ConnectionCircleStrength;
  readonly source: ConnectionCircleSource;
  readonly nextStep: ConnectionCircleNextStep;
}

export interface ConnectionCircleResult {
  readonly circle: ConnectionCircleNumber;
  readonly state: ConnectionCircleState;
  readonly message: string;
  readonly paths: readonly ConnectionCirclePath[];
  /** Circle 2 only (B561): paths through other platform members — a count, never names. */
  readonly platformPaths?: { readonly paths: number };
}

export interface CandidateWorkplaceForLetter {
  readonly id: string;
  readonly employer: string | null;
  readonly title: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly current: boolean;
  readonly evidenceIds: readonly string[];
}

export interface VacancyConnectionCircles {
  readonly vacancyId: string;
  readonly companyKey: string;
  readonly companyName: string;
  readonly vacancyTitle: string;
  readonly circles: readonly ConnectionCircleResult[];
  readonly linkedinImport: {
    readonly state: 'imported' | 'unknown';
    readonly importedAt: string | null;
    readonly importedCount: number | null;
  };
}

export interface ApprovedVacancyLetterInput {
  readonly circle: ConnectionCircleNumber;
  readonly language: LetterLanguage;
  readonly tone: LetterTone;
  readonly recipient?: {
    readonly id?: string;
    readonly name: string;
    readonly role?: string;
    readonly company?: string;
  };
  readonly subject?: string;
  readonly body: string;
  readonly usedEvidenceIds: readonly string[];
  readonly includedWorkplaceIds: readonly string[];
}

export interface ApprovedVacancyLetterResult {
  readonly applicationId: string;
  readonly documentId: string;
  readonly approvedAt: string;
  readonly status: 'approved';
  readonly sent: false;
}

export async function getVacancyConnectionCircles(
  vacancyId: string,
): Promise<VacancyConnectionCircles> {
  const response = await apiFetch(
    '/api/v1/candidate/vacancies/' + encodeURIComponent(vacancyId) + '/connection-circles',
    { method: 'GET' },
  );
  return readData<VacancyConnectionCircles>(response);
}

export async function approveVacancyLetter(
  vacancyId: string,
  input: ApprovedVacancyLetterInput,
): Promise<ApprovedVacancyLetterResult> {
  const response = await apiFetch(
    '/api/v1/candidate/vacancies/' + encodeURIComponent(vacancyId) + '/letter-approvals',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return readData<ApprovedVacancyLetterResult>(response);
}
