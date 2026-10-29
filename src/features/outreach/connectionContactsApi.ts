import { apiFetch, readData } from '../coach/apiClient';

export type ConnectionContactStrength = 'strong' | 'weak' | 'unknown';
export type ConnectionContactSource = 'manual' | 'linkedin_import';

export interface ConnectionContactWorkplaceInput {
  readonly companyName: string;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export interface ConnectionContactInput {
  readonly fullName: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly relationship: string;
  readonly strength: ConnectionContactStrength;
  readonly linkedinUrl?: string | null;
  readonly workplaces: readonly ConnectionContactWorkplaceInput[];
  readonly knowsRecruiterIds: readonly string[];
}

export interface CandidateConnectionContact extends ConnectionContactInput {
  readonly id: string;
  readonly source: ConnectionContactSource;
  readonly linkedinUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CandidateConnectionContactsPage {
  readonly items: readonly CandidateConnectionContact[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly nextOffset: number | null;
  readonly linkedinImport: {
    readonly state: 'unknown' | 'imported';
    readonly importedAt: string | null;
    readonly importedCount: number | null;
  };
}

export async function listCandidateConnectionContacts(
  offset = 0,
): Promise<CandidateConnectionContactsPage> {
  const query = new URLSearchParams({ limit: '100', offset: String(offset) });
  const response = await apiFetch('/api/v1/candidate/connection-contacts?' + query.toString(), {
    method: 'GET',
  });
  return readData<CandidateConnectionContactsPage>(response);
}

export async function saveCandidateConnectionContact(
  contactId: string,
  input: ConnectionContactInput,
): Promise<CandidateConnectionContact> {
  const response = await apiFetch(
    '/api/v1/candidate/connection-contacts/' + encodeURIComponent(contactId),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return readData<CandidateConnectionContact>(response);
}

export async function deleteCandidateConnectionContact(contactId: string): Promise<void> {
  const response = await apiFetch(
    '/api/v1/candidate/connection-contacts/' + encodeURIComponent(contactId),
    { method: 'DELETE' },
  );
  if (!response.ok) await readData<unknown>(response);
}

export interface LinkedInConnectionImportContact {
  readonly fullName: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly linkedinUrl: string | null;
}

export interface LinkedInConnectionImportReceipt {
  readonly state: 'imported';
  readonly importedAt: string;
  readonly importedCount: number;
}

/**
 * Updates the candidate's LinkedIn-sourced contacts; people the list does not
 * name are kept, since a capped read is shorter, not newer (29.10). Manual ones stay (B448).
 */
export async function importLinkedInConnectionContacts(
  contacts: readonly LinkedInConnectionImportContact[],
): Promise<LinkedInConnectionImportReceipt> {
  const response = await apiFetch('/api/v1/candidate/connection-contacts/linkedin-import', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contacts }),
  });
  return readData<LinkedInConnectionImportReceipt>(response);
}

export interface LinkedInCompanySearchTarget {
  readonly companyKey: string;
  readonly companyName: string;
}

/** B561: companies to search in the 1st circle, wanted first, each once per 14 days. */
export async function loadLinkedInCompanySearchPlan(): Promise<
  readonly LinkedInCompanySearchTarget[]
> {
  const response = await apiFetch('/api/v1/candidate/connection-contacts/linkedin-search-plan', {
    method: 'GET',
  });
  return (await readData<{ companies: LinkedInCompanySearchTarget[] }>(response)).companies;
}

export interface LinkedInSearchedPerson {
  readonly fullName: string;
  readonly linkedinUrl: string;
  readonly roleTitle: string;
  readonly companyName: string;
}

/** B561: people read from one company search; the server gives them their current company. */
export async function reportLinkedInCompanySearch(
  companyName: string,
  people: readonly LinkedInSearchedPerson[],
): Promise<{ readonly updated: number; readonly added: number }> {
  const response = await apiFetch('/api/v1/candidate/connection-contacts/linkedin-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName, people: people.slice(0, 50) }),
  });
  return readData<{ updated: number; added: number }>(response);
}
