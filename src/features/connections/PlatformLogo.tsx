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

/**
 * hh.ru prints its mark as a red tile carrying two block "h" letterforms; it is
 * reconstructed here from plain rectangles so it stays crisp at every size.
 */
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
      <rect width="24" height="24" rx="4.4" fill="#D6001C" />
      <g fill="#FFFFFF">
        <rect x="4" y="5" width="2.3" height="14" rx="0.5" />
        <rect x="6.3" y="10.4" width="2.3" height="2.3" />
        <rect x="8.6" y="10.4" width="2.3" height="8.6" rx="0.5" />
        <rect x="13.1" y="5" width="2.3" height="14" rx="0.5" />
        <rect x="15.4" y="10.4" width="2.3" height="2.3" />
        <rect x="17.7" y="10.4" width="2.3" height="8.6" rx="0.5" />
      </g>
    </svg>
  );
}
