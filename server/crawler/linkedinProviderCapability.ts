export type LinkedinProviderCapabilityVerdict =
  | 'not_configured'
  | 'official_api'
  | 'provider_permitted';

export interface LinkedinProviderCapability {
  readonly verdict: LinkedinProviderCapabilityVerdict;
  readonly reason: 'provider_permission_required' | 'official_capability_configured' | 'owner_decision_2026_11_03';
}

/**
 * Owner decision 2026-11-03 (supersedes the B242 prohibition): LinkedIn is read
 * through the public guest search (primary) and through the service-account
 * pool (additional). The verdict is recorded here, in one place, so the guest
 * reader, the crawler and the pool all see the same answer. The polite pace,
 * 429 backoff and "partial reading never replaces the slice" rules stay in the
 * readers themselves.
 */
export function linkedinProviderCapability(): LinkedinProviderCapability {
  return {
    verdict: 'provider_permitted',
    reason: 'owner_decision_2026_11_03',
  };
}

export function hasLinkedinProviderCapability(): boolean {
  return linkedinProviderCapability().verdict !== 'not_configured';
}
