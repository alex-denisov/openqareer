/**
 * Section icons for the rail, drawn for these sections and nothing else.
 *
 * The rail used to borrow whatever generic glyph was nearest in the icon set —
 * a circled bust for the candidate, a plain sheet for «Резюме». The owner named this on the
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

/** «Поиск» — the radar that keeps sweeping for a match. */
export function SearchIcon({
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

/** «Вакансии» — the collected pool itself: a case with what is inside it. */
export function VacanciesIcon({ size = 22, active = false }: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <rect x="3" y="7.4" width="18" height="12.6" rx="2.4" />
      <path
        d="M8.6 7.4V5.5a1.8 1.8 0 0 1 1.8-1.8h3.2a1.8 1.8 0 0 1 1.8 1.8v1.9"
        strokeLinecap="round"
      />
      <path d="M3 12.4h18" />
      <path
        d="M10.4 12.4h3.2"
        strokeWidth="2.6"
        strokeLinecap="round"
        stroke={active ? 'currentColor' : undefined}
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
