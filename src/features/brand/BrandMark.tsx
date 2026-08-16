import { useId } from 'react';

export type BrandTone = 'brand' | 'mono';
export type BrandVariant = 'mark' | 'lockup';

interface BrandMarkProps {
  /** `mark` draws the sign alone; `lockup` sets it beside the wordmark. */
  variant?: BrandVariant;
  /**
   * Edge length of the sign in pixels. The wordmark is sized by the stylesheet
   * rather than by this prop: production serves `style-src 'self'`, which drops
   * any inline style attribute, so a size written into `style` would silently
   * do nothing there.
   */
  size?: number;
  /** `mono` inherits `currentColor` for inverted or single-ink surfaces. */
  tone?: BrandTone;
  /** Overrides the generated gradient id namespace. Mostly for tests. */
  idPrefix?: string;
  className?: string;
}

/** Sampled directly from the owner-provided logo (B138, 2026-08-16). */
const BRAND_LIGHT = '#0488F4';
const BRAND_CORE = '#0A70E0';
const BRAND_DEEP = '#0F43A2';

// Geometry measured off the owner's logo.png rather than eyeballed: the sign
// bounding box was normalised to this 64×64 grid, and the tail axis was fitted
// by principal-component analysis of the pixels lying outside the ring. The
// tail runs at 42.9°, not 45°, and its axis misses the ring centre by 13px at
// source scale — drawing it radially is what makes a redraw look "almost right".
const RING_CX = 31.87;
const RING_CY = 32;
const RING_RADIUS = 25.2;
const RING_WEIGHT = 11.59;
const TAIL_X1 = 37.34;
const TAIL_Y1 = 41.9;
const TAIL_X2 = 57.3;
const TAIL_Y2 = 60.45;
const TAIL_WEIGHT = 10.33;
// Reproduces the two ~8° hairlines the original leaves where tail crosses ring.
const TAIL_CUT_WEIGHT = 17.5;

export function BrandMark({
  variant = 'mark',
  size = 28,
  tone = 'brand',
  idPrefix,
  className,
}: BrandMarkProps) {
  const generatedId = useId().replace(/:/gu, '');
  const prefix = idPrefix ?? `brand-${generatedId}`;
  const sign = (
    <BrandSign
      prefix={prefix}
      size={size}
      tone={tone}
      className={variant === 'mark' ? className : 'brand-lockup-sign'}
      decorative={variant === 'lockup'}
    />
  );

  if (variant === 'mark') return sign;

  const lockupClasses = ['brand-lockup'];
  if (tone === 'mono') lockupClasses.push('is-mono');
  if (className) lockupClasses.push(className);

  return (
    <span className={lockupClasses.join(' ')}>
      {sign}
      <span className="brand-lockup-word">
        <span className="brand-lockup-open">open</span>
        <span className="brand-lockup-qareer">qareer</span>
      </span>
    </span>
  );
}

function BrandSign({
  prefix,
  size,
  tone,
  className,
  decorative,
}: {
  prefix: string;
  size: number;
  tone: BrandTone;
  className?: string;
  decorative: boolean;
}) {
  const ringId = `${prefix}-ring`;
  const cutId = `${prefix}-cut`;
  const ink = tone === 'mono' ? 'currentColor' : `url(#${ringId})`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'openqareer'}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
    >
      <BrandSignDefs ringId={ringId} cutId={cutId} tone={tone} />
      <circle
        cx={RING_CX}
        cy={RING_CY}
        r={RING_RADIUS}
        stroke={ink}
        strokeWidth={RING_WEIGHT}
        mask={`url(#${cutId})`}
      />
      <line
        x1={TAIL_X1}
        y1={TAIL_Y1}
        x2={TAIL_X2}
        y2={TAIL_Y2}
        stroke={ink}
        strokeWidth={TAIL_WEIGHT}
        strokeLinecap="round"
      />
    </svg>
  );

}

function BrandSignDefs({
  ringId,
  cutId,
  tone,
}: {
  ringId: string;
  cutId: string;
  tone: BrandTone;
}) {
  return (
    <defs>
      {tone === 'brand' ? (
        <linearGradient id={ringId} x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={BRAND_LIGHT} />
          <stop offset="0.55" stopColor={BRAND_CORE} />
          <stop offset="1" stopColor={BRAND_DEEP} />
        </linearGradient>
      ) : null}
      {/* Keeps a hairline of background between tail and ring, so the two
          strokes read as one drawn letter instead of two stacked shapes. */}
      <mask id={cutId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        <rect x="0" y="0" width="64" height="64" fill="#fff" />
        <line
          x1={TAIL_X1}
          y1={TAIL_Y1}
          x2={TAIL_X2}
          y2={TAIL_Y2}
          stroke="#000"
          strokeWidth={TAIL_CUT_WEIGHT}
          strokeLinecap="round"
        />
      </mask>
    </defs>
  );
}
