import type { ConnectionPlatform } from './platformLabels';

/**
 * The connector cards name a specific company, so they carry that company's
 * mark. A generic globe made two different platforms look like the same
 * anonymous "web import" and gave the candidate nothing to recognise (B148 §1).
 *
 * Marks are drawn inline: production serves `style-src 'self'` and blocks
 * remote assets, so a hosted logo would silently fail to appear.
 */
interface PlatformLogoProps {
  readonly platform: ConnectionPlatform;
  readonly size?: number;
  readonly title?: string;
}

export function PlatformLogo({ platform, size = 24, title }: PlatformLogoProps) {
  return platform === 'linkedin' ? (
    <LinkedInMark size={size} title={title} />
  ) : (
    <HeadHunterMark size={size} title={title} />
  );
}

function LinkedInMark({ size, title }: { size: number; title?: string }) {
  return (
    <svg
      className="career-platform-logo is-linkedin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="24" height="24" rx="4.4" fill="#0A66C2" />
      <path
        fill="#FFFFFF"
        d="M7.72 19.2H4.86V9.86h2.86v9.34ZM6.29 8.6a1.66 1.66 0 1 1 0-3.32 1.66 1.66 0 0 1 0 3.32Zm12.91 10.6h-2.85v-4.55c0-1.08-.02-2.48-1.51-2.48-1.52 0-1.75 1.18-1.75 2.4v4.63H10.2V9.86h2.74v1.28h.04c.38-.72 1.31-1.48 2.7-1.48 2.89 0 3.42 1.9 3.42 4.37v5.17Z"
      />
    </svg>
  );
}

/** hh.ru uses a red circle with a white lowercase `hh` monogram. */
function HeadHunterMark({ size, title }: { size: number; title?: string }) {
  return (
    <svg
      className="career-platform-logo is-hh"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <circle cx="12" cy="12" r="12" fill="#D6001C" />
      <path
        fill="#FFFFFF"
        d="M4.4 5.4h2.8v4.8c.7-.8 1.6-1.2 2.7-1.2 2.2 0 3.3 1.4 3.3 4.1V18h-2.8v-4.6c0-1-.3-1.6-1.2-1.6-.9 0-1.3.6-1.3 1.6V18H4.4V5.4Zm8.9 0h2.8v4.8c.7-.8 1.6-1.2 2.7-1.2 2.2 0 3.3 1.4 3.3 4.1V18h-2.8v-4.6c0-1-.3-1.6-1.2-1.6-.9 0-1.3.6-1.3 1.6V18h-2.8V5.4Z"
      />
    </svg>
  );
}
