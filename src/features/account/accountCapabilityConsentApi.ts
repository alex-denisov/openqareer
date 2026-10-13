import { apiFetch, readDataObject } from '../coach/apiClient';
import type { CandidateCapability } from '../legal/capabilityConsents';

export interface AccountCapabilityConsentRecord {
  readonly id: string;
  readonly capability: CandidateCapability;
  readonly versionId: string;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

export async function getAccountCapabilityConsents(): Promise<AccountCapabilityConsentRecord[]> {
  const response = await apiFetch('/api/v1/me/consents', { cache: 'no-store' });
  const data = await readDataObject<{ consents: AccountCapabilityConsentRecord[] }>(response);
  return data.consents;
}

export async function grantAccountCapabilityConsent(
  capability: CandidateCapability,
  versionId: string,
): Promise<AccountCapabilityConsentRecord> {
  const response = await apiFetch(`/api/v1/me/consents/${capability}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionId }),
  });
  const data = await readDataObject<{ consent: AccountCapabilityConsentRecord }>(response);
  return data.consent;
}

export async function revokeAccountCapabilityConsent(
  capability: CandidateCapability,
): Promise<AccountCapabilityConsentRecord | null> {
  const response = await apiFetch(`/api/v1/me/consents/${capability}`, { method: 'DELETE' });
  const data = await readDataObject<{ consent: AccountCapabilityConsentRecord | null }>(response);
  return data.consent;
}
