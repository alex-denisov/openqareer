/**
 * Тип занятости вакансии (B646-7): чип рядом с форматом работы в списке и карточке.
 * Разбор без модели по названию и выжимке; не распознан — чипа нет.
 */
export type VacancyEmploymentKind = 'full' | 'part' | 'project' | 'internship';

const RULES: readonly (readonly [VacancyEmploymentKind, RegExp])[] = [
  [
    'internship',
    /стажир|стаж[её]р|практикант|\bintern(?:ship)?\b|\btrainee\b|werkstudent|praktikum/iu,
  ],
  [
    'project',
    /проектн|разов|\bfreelance|фриланс|\bcontract(?:or)?\b|договор гпх|\bгпх\b|\bproject[- ]based|временн|\btemporary\b/iu,
  ],
  ['part', /частичн|неполн|part[- ]?time|teilzeit|подработк/iu],
  [
    'full',
    /полная занятость|полный (?:рабочий )?день|full[- ]?time|vollzeit|\bpermanent\b|\bcdi\b/iu,
  ],
];

export function detectVacancyEmploymentKind(input: {
  readonly title: string;
  readonly summary?: string;
}): VacancyEmploymentKind | undefined {
  const text = `${input.title} ${input.summary ?? ''}`;
  return RULES.find(([, pattern]) => pattern.test(text))?.[0];
}

const LABELS: Readonly<Record<VacancyEmploymentKind, string>> = {
  full: 'полная',
  part: 'частичная',
  project: 'проект',
  internship: 'стажировка',
};

export function employmentKindLabel(kind: VacancyEmploymentKind | undefined): string | undefined {
  return kind ? LABELS[kind] : undefined;
}
