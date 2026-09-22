export type LinkedinProviderCapabilityVerdict =
  | 'not_configured'
  | 'official_api'
  | 'provider_permitted';

export interface LinkedinProviderCapability {
  readonly verdict: LinkedinProviderCapabilityVerdict;
  readonly reason: 'provider_permission_required' | 'official_capability_configured';
}

/**
 * B242 deliberately has no environment switch that turns the legacy browser
 * crawler on. A pool profile or an owner decision is not provider permission.
 * A future official/provider adapter must supply its own capability verdict
 * and bounded transport instead of reusing Obscura or the old guest fetcher.
 */
export function linkedinProviderCapability(): LinkedinProviderCapability {
  return {
    verdict: 'not_configured',
    reason: 'provider_permission_required',
  };
}

export function hasLinkedinProviderCapability(): boolean {
  return linkedinProviderCapability().verdict !== 'not_configured';
}
