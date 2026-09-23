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

/**
 * «Сегодня» (B248) — a day square with a done mark: today, decided. Verbatim
 * from `docs/v1-release/tasks/work/B248/assets/icons.js` (`today`).
 */
export function TodayIcon({ size = 22 }: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.6" />
      <path d="M3.4 9.6h17.2" strokeLinecap="round" />
      <path d="M7.6 3.4v3.6M16.4 3.4v3.6" strokeLinecap="round" />
      <path d="M8 14.6l2.3 2.3 5.1-5.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * «Отклики» (B248) — a small pipeline of three stages. Verbatim from
 * `docs/v1-release/tasks/work/B248/assets/icons.js` (`responses`).
 */
export function ResponsesIcon({ size = 22 }: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <rect x="2.6" y="4.4" width="5.4" height="15.2" rx="1.8" />
      <rect x="9.3" y="4.4" width="5.4" height="15.2" rx="1.8" />
      <rect x="16" y="4.4" width="5.4" height="15.2" rx="1.8" />
      <path d="M4.4 8h2M11.1 8h2M17.8 8h2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * «Консультант» (B248) — a speech bubble with a person inside. Verbatim from
 * `docs/v1-release/tasks/work/B248/assets/icons.js` (`consultant`).
 */
export function ConsultantIcon({ size = 22 }: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <path
        d="M4 5.6h16a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H10.4L6 21.2V17.2H4A1.6 1.6 0 0 1 2.4 15.6V7.2A1.6 1.6 0 0 1 4 5.6Z"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10.6" r="1.7" />
      <path d="M8.7 14.4c.8-1.5 2-2.2 3.3-2.2s2.5.7 3.3 2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Path-indicator dot mark — verbatim `check` glyph from B248's icon sprite. */
export function PathCheckIcon({ size = 13 }: SectionIconProps) {
  return (
    <svg {...frame(size)}>
      <path d="M4.5 12.5l5 5 10-11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
