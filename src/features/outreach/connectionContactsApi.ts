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
