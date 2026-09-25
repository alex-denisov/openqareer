export interface TargetDirectionSources {
  readonly campaignRoles?: readonly string[];
  readonly profileHeadline?: string | null;
  readonly resumeTargetRole?: string | null;
  readonly wizardTargetDirection?: string | null;
}

/**
 * Resolves the role shown to the candidate without rewriting their older
 * wizard answer. The campaign is the current search decision; imported
 * profile fields are fallbacks when no campaign has been selected yet.
 */
export function visibleTargetDirection(sources: TargetDirectionSources): string {
  const campaignRole = sources.campaignRoles?.find((role) => role.trim());
  return (
    campaignRole?.trim() ||
    sources.profileHeadline?.trim() ||
    sources.resumeTargetRole?.trim() ||
    sources.wizardTargetDirection?.trim() ||
    ''
  );
}
