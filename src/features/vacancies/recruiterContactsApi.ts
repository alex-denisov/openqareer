import type { RecruiterContact } from '../../../shared/recruiterContact';
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

export async function getRecruiterContacts(vacancyId: string): Promise<RecruiterContact[]> {
  const response = await apiFetch(`/api/v1/vacancies/${encodeURIComponent(vacancyId)}/contacts`);
  const data = await readData<{ contacts: RecruiterContact[] }>(response);
  return data.contacts ?? [];
}

export async function enrichRecruiterContacts(
  vacancyId: string,
  vacancy?: EnrichVacancyPayload,
): Promise<RecruiterContact[]> {
  const response = await apiFetch(
    `/api/v1/vacancies/${encodeURIComponent(vacancyId)}/enrich-contacts`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ vacancy }),
    },
  );
  const data = await readData<{ contacts: RecruiterContact[] }>(response);
  return data.contacts ?? [];
}
