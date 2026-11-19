/** Разделы трат C06: ежемесячные и разовые, в валюте страны. */
export type CostKey =
  | 'rent'
  | 'utilities'
  | 'food'
  | 'transport'
  | 'insurance'
  | 'education'
  | 'other'
  | 'moving'
  | 'deposit';

export interface CostSection {
  readonly key: CostKey;
  readonly label: string;
  readonly once: boolean;
}

export const COST_SECTIONS: readonly CostSection[] = [
  { key: 'rent', label: 'Жильё', once: false },
  { key: 'utilities', label: 'Коммунальные', once: false },
  { key: 'food', label: 'Еда и быт', once: false },
  { key: 'transport', label: 'Транспорт', once: false },
  { key: 'insurance', label: 'Здоровье', once: false },
  { key: 'education', label: 'Дети и учёба', once: false },
  { key: 'other', label: 'Прочее', once: false },
  { key: 'moving', label: 'Переезд, разово', once: true },
  { key: 'deposit', label: 'Залог за жильё', once: true },
];

/** Запас на старте: столько месяцев трат. */
export const RESERVE_MONTHS = 3;

export type CostValues = Partial<Record<CostKey, number>>;

export interface Family {
  readonly partner: boolean;
  readonly children: number;
}

function childrenWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ребёнок';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ребёнка';
  return 'детей';
}

export function whoLabel(family: Family | null): string {
  if (!family || (!family.partner && family.children === 0)) return 'только вы';
  const kids = family.children > 0 ? `${family.children} ${childrenWord(family.children)}` : null;
  if (family.partner) return kids ? `вы, партнёр и ${kids}` : 'вы и партнёр';
  return `вы и ${kids}`;
}

export const householdOf = (family: Family | null): number =>
  family ? 1 + (family.partner ? 1 : 0) + family.children : 1;

export interface CostsSummary {
  readonly missing: number;
  readonly monthly: number;
  /** Остаётся на жизнь в месяц; только когда заполнены все ежемесячные разделы. */
  readonly remaining: number | null;
  /** Нужно на старте: разовые, залог и запас на RESERVE_MONTHS месяцев; только при всех разделах. */
  readonly startCash: number | null;
}

/** Остаток и старт; раздел «Не про меня» считается заполненным и в сумму не входит. */
export function costsSummary(
  values: CostValues,
  net: number,
  skipped: readonly CostKey[] = [],
): CostsSummary {
  const isSkipped = (section: CostSection) => skipped.includes(section.key);
  const filled = (section: CostSection) => isSkipped(section) || values[section.key] !== undefined;
  const sum = (sections: readonly CostSection[]) =>
    sections.reduce(
      (total, section) => total + (isSkipped(section) ? 0 : (values[section.key] ?? 0)),
      0,
    );
  const monthlySections = COST_SECTIONS.filter((section) => !section.once);
  const onceSections = COST_SECTIONS.filter((section) => section.once);
  const monthly = sum(monthlySections);
  const monthlyDone = monthlySections.every(filled);
  return {
    missing: COST_SECTIONS.filter((section) => !filled(section)).length,
    monthly,
    remaining: monthlyDone ? net - monthly : null,
    startCash:
      monthlyDone && onceSections.every(filled)
        ? sum(onceSections) + RESERVE_MONTHS * monthly
        : null,
  };
}
