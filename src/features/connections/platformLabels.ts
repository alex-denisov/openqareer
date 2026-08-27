export const CONNECTION_PLATFORMS = ['linkedin', 'hh'] as const;

export type ConnectionPlatform = (typeof CONNECTION_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<ConnectionPlatform, string> = {
  linkedin: 'LinkedIn',
  hh: 'hh.ru',
};
