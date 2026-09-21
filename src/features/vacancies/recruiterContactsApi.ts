import type { RecruiterContact, RecruiterContactJob } from '../../../shared/recruiterContact';
import { apiFetch, readData } from '../coach/apiClient';

export interface EnrichVacancyPayload {
  readonly id?: string;
  readonly title?: string;
  readonly company?: string;
  readonly url?: string;
  readonly description?: string;
  readonly fullDescription?: string;
  readonly contactInfo?: string;
}

export interface RecruiterContactsResponse {
  readonly contacts: RecruiterContact[];
  readonly job: RecruiterContactJob | null;
}

export async function getRecruiterContacts(vacancyId: string): Promise<RecruiterContactsResponse> {
  const response = await apiFetch(`/api/v1/vacancies/${encodeURIComponent(vacancyId)}/contacts`);
  const data = await readData<RecruiterContactsResponse>(response);
  return { contacts: data.contacts ?? [], job: data.job ?? null };
}

export async function enrichRecruiterContacts(
  vacancyId: string,
  _vacancy?: EnrichVacancyPayload,
): Promise<RecruiterContactsResponse> {
  const response = await apiFetch(
    `/api/v1/vacancies/${encodeURIComponent(vacancyId)}/enrich-contacts`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  const data = await readData<RecruiterContactsResponse>(response);
  return { contacts: data.contacts ?? [], job: data.job ?? null };
}
