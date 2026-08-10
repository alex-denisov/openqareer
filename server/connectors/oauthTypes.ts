export const OAUTH_PLATFORMS = ['linkedin', 'hh'] as const;

export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];
