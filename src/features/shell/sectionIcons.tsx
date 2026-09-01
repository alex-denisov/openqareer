/**
 * Section icons for the rail, drawn for these sections and nothing else.
 *
 * The rail used to borrow whatever generic glyph was nearest in the icon set —
 * a circled bust for the candidate, a plain sheet for
 * «Резюме», an abstract fork for «Карьера». The owner named this on the
 * «Пульт» walkthrough: the icons must read as the section they open. Each one
 * below draws the object the section is actually about, on the same 24-unit
 * grid with the same 1.7 stroke, so the rail reads as one set.
 *
 * They inherit `currentColor`, so the active and locked states are the rail's
 * business, not the icon's.
 */

export interface SectionIconProps {
  readonly size?: number;
  /** Filled accents mark the current section; state is never colour alone. */
  readonly active?: boolean;
}

function frame(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    'aria-hidden': true,
  } as const;
}

/** «Главная» — the candidate's own card: who you are by the facts. */
export function ProfileIcon({ size = 22, active = false }: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <rect x="3" y="4.6" width="18" height="14.8" rx="2.6" />
      <circle cx="9" cy="10.6" r="2.4" fill={active ? 'currentColor' : 'none'} />
      <path
        d="M5.6 16.4c.7-1.9 2-2.8 3.4-2.8s2.7.9 3.4 2.8"
        strokeLinecap="round"
      />
      <path d="M15 9.6h3.4M15 13.1h3.4" strokeLinecap="round" />
    </svg>
  );
}

/** «Резюме» — the document itself: a photo block, a headline, body lines. */
export function ResumeIcon({ size = 22, active = false }: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <path
        d="M5.4 2.9h8.1l5.1 5v13.2a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1V3.9a1 1 0 0 1 1-1Z"
        strokeLinejoin="round"
      />
      <path d="M13.5 2.9v5h5.1" strokeLinejoin="round" />
      <rect
        x="7"
        y="10.4"
        width="3.6"
        height="3.6"
        rx="0.9"
        fill={active ? 'currentColor' : 'none'}
      />
      <path d="M12.4 11.3h4.2M12.4 13.6h4.2M7 16.8h9.6" strokeLinecap="round" />
    </svg>
  );
}

/** «Карьера» — the route: steps behind, milestones ahead. */
export function CareerIcon({ size = 22, active = false }: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <path
        d="M5.4 19.4c0-3.2 2.1-4.1 5.1-4.6 3-.5 5.1-1.4 5.1-4.6"
        strokeLinecap="round"
      />
      <circle cx="5.4" cy="19.4" r="1.9" fill={active ? 'currentColor' : 'none'} />
      <circle cx="12" cy="16.2" r="1.5" />
      <circle cx="15.6" cy="10.2" r="1.9" fill={active ? 'currentColor' : 'none'} />
      <path d="M15.6 3.4v3.2M12.6 5.1h6" strokeLinecap="round" />
    </svg>
  );
}

/** «Возможности» — the radar that keeps sweeping for a match. */
export function OpportunitiesIcon({
  size = 22,
  active = false,
}: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.2" />
      <circle
        cx="12"
        cy="12"
        r="1.2"
        fill={active ? 'currentColor' : 'none'}
        stroke={active ? 'none' : 'currentColor'}
      />
      <path
        d="M12 1.9v2.3M12 19.8v2.3M1.9 12h2.3M19.8 12h2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** «Тарифы» — the plan facet, the same shape the plan card carries. */
export function TariffsIcon({ size = 22, active = false }: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <path
        d="M12 3.2 20.4 12 12 20.8 3.6 12z"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
      />
    </svg>
  );
}
