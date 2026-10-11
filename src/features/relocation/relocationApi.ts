import {
  RELOCATION_CONSENT_VERSION,
  type CitizenshipDocumentsStep,
  type EducationStep,
  type FamilyStep,
  type RelocationAlert,
  type RelocationConsentState,
  type RelocationCurrentStep,
  type RelocationQuestionnaire,
  type RelocationStepId,
  type RelocationLanguageStepInput,
} from '../../../shared/relocationQuestionnaire';
import { apiFetch, readDataObject } from '../coach/apiClient';

export interface RelocationQuestionnaireResponse {
  readonly profile: RelocationQuestionnaire | null;
  readonly consent: RelocationConsentState;
  readonly consentTextStatus: 'pending_dpo_review';
  readonly alerts: readonly RelocationAlert[];
}

export interface RelocationQuestionnaireWriteResult {
  readonly profile: RelocationQuestionnaire;
  readonly alerts: readonly RelocationAlert[];
}

export interface RelocationQuestionnaireProgress {
  readonly currentStep: RelocationCurrentStep;
  readonly skippedSteps: readonly RelocationStepId[];
}

export interface RelocationConsentWriteResult {
  readonly consent: RelocationConsentState;
}

export interface RelocationConsentRevokeResult extends RelocationConsentWriteResult {
  readonly revoked: boolean;
  readonly deleted: true;
}

export interface RelocationProfileDeleteResult {
  readonly deleted: boolean;
  readonly consent: RelocationConsentState;
}

export type RelocationStepInput = {
  readonly citizenship_documents: CitizenshipDocumentsStep;
  readonly education: EducationStep;
  readonly family: FamilyStep;
  readonly languages: RelocationLanguageStepInput;
};

export async function getRelocationQuestionnaire(
  signal?: AbortSignal,
): Promise<RelocationQuestionnaireResponse> {
  const response = signal
    ? await apiFetch('/api/v1/candidate/relocation-questionnaire', { signal })
    : await apiFetch('/api/v1/candidate/relocation-questionnaire');
  return readDataObject<RelocationQuestionnaireResponse>(response);
}

export async function putRelocationQuestionnaireStep<K extends RelocationStepId>(
  step: K,
  data: RelocationStepInput[K],
  revision: number,
): Promise<RelocationQuestionnaireWriteResult> {
  const response = await apiFetch(
    `/api/v1/candidate/relocation-questionnaire/steps/${step}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': quotedRevision(revision) },
      body: JSON.stringify(data),
    },
  );
  return readDataObject<RelocationQuestionnaireWriteResult>(response);
}

export async function putRelocationQuestionnaireProgress(
  data: RelocationQuestionnaireProgress,
  revision: number,
): Promise<RelocationQuestionnaireWriteResult> {
  const response = await apiFetch('/api/v1/candidate/relocation-questionnaire/progress', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': quotedRevision(revision) },
    body: JSON.stringify(data),
  });
  return readDataObject<RelocationQuestionnaireWriteResult>(response);
}

export async function importRelocationLanguagesFromLinkedIn(
  revision: number,
): Promise<RelocationQuestionnaireWriteResult> {
  const response = await apiFetch(
    '/api/v1/candidate/relocation-questionnaire/languages/linkedin',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': quotedRevision(revision) },
      body: JSON.stringify({}),
    },
  );
  return readDataObject<RelocationQuestionnaireWriteResult>(response);
}

export async function grantRelocationConsent(): Promise<RelocationConsentWriteResult> {
  const response = await apiFetch('/api/v1/candidate/relocation-questionnaire/consent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId: RELOCATION_CONSENT_VERSION }),
  });
  return readDataObject<RelocationConsentWriteResult>(response);
}

export async function revokeRelocationConsent(): Promise<RelocationConsentRevokeResult> {
  const response = await apiFetch('/api/v1/candidate/relocation-questionnaire/consent', {
    method: 'DELETE',
  });
  return readDataObject<RelocationConsentRevokeResult>(response);
}

export async function restartRelocationQuestionnaire(): Promise<RelocationProfileDeleteResult> {
  const response = await apiFetch('/api/v1/candidate/relocation-questionnaire', {
    method: 'DELETE',
  });
  return readDataObject<RelocationProfileDeleteResult>(response);
}

function quotedRevision(revision: number): string {
  return `"${revision}"`;
}
