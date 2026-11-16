import { useId } from 'react';

/** Знак openqareer для рейла: геометрия общего знака, цвет — акцент темы. */
export function BrandMark() {
  const maskId = `b640-mark-${useId().replace(/:/gu, '')}`;
  return (
    <svg
      className="brand-mark"
      viewBox="-2.435 -0.995 68.61 68.61"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
          <rect x="-8" y="-8" width="80" height="80" fill="#fff" />
          <line
            x1="37.34"
            y1="41.9"
            x2="57.3"
            y2="60.45"
            stroke="#000"
            strokeWidth="17.5"
            strokeLinecap="round"
          />
        </mask>
      </defs>
      <circle
        cx="31.87"
        cy="32"
        r="25.2"
        stroke="currentColor"
        strokeWidth="11.59"
        mask={`url(#${maskId})`}
      />
      <line
        x1="37.34"
        y1="41.9"
        x2="57.3"
        y2="60.45"
        stroke="currentColor"
        strokeWidth="10.33"
        strokeLinecap="round"
      />
    </svg>
  );
}
