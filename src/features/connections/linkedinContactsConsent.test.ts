import { describe, expect, it } from 'vitest';
import type { CandidateCapability } from '../legal/capabilityConsents';
import { linkedInContactsConsentActive } from './linkedinContactsConsent';

const record = (
  grantedAt: string,
  revokedAt: string | null,
  capability: CandidateCapability = 'linkedin_contacts',
) =>
  ({
    id: grantedAt,
    capability,
    versionId: 'linkedin_contacts-v1.0',
    grantedAt,
    revokedAt,
  }) as const;

describe('linkedInContactsConsentActive (B561)', () => {
  it('follows the latest LinkedIn contacts consent record only', () => {
    expect(linkedInContactsConsentActive([])).toBe(false);
    expect(linkedInContactsConsentActive([record('2026-10-29T10:00:00Z', null)])).toBe(true);
    expect(
      linkedInContactsConsentActive([
        record('2026-10-29T10:00:00Z', null),
        record('2026-10-30T10:00:00Z', '2026-10-30T11:00:00Z'),
      ]),
    ).toBe(false);
    expect(
      linkedInContactsConsentActive([record('2026-10-29T10:00:00Z', null, 'profile_activity')]),
    ).toBe(false);
  });
});
