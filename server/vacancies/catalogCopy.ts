/** «1 вакансия», «24 вакансии», «155 000 вакансий» — число с верным склонением. */
export function countLabel(value: number): string {
  const tens = value % 100;
  const ones = value % 10;
  const word =
    tens >= 11 && tens <= 14
      ? 'вакансий'
      : ones === 1
        ? 'вакансия'
        : ones >= 2 && ones <= 4
          ? 'вакансии'
          : 'вакансий';
  return `${value.toLocaleString('ru-RU').replace(/\u00a0/gu, '\u202f')} ${word}`;
}

export interface FactsEntry {
  readonly company: string;
  readonly isRemote: boolean;
  readonly salaryLabel?: string;
  readonly skills: readonly string[];
  readonly lastSeenAt: string;
}

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** «20 октября 2026» from an ISO date; the raw value when it does not parse. */
export function formatRuDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return iso.slice(0, 10);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function topSkills(entries: readonly FactsEntry[], limit: number): readonly string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const skill of new Set(entry.skills.map((value) => value.trim()).filter(Boolean))) {
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([skill]) => skill);
}

/**
 * Quotable facts about a catalog page (AEO): every number is counted over the
 * cards on this page, and the sentence says so.
 */
export function pageFacts(total: number, entries: readonly FactsEntry[]): readonly string[] {
  if (entries.length === 0) return [];
  const salaried = entries.filter((entry) => entry.salaryLabel).length;
  const remote = entries.filter((entry) => entry.isRemote).length;
  const employers = new Set(entries.map((entry) => entry.company.trim().toLowerCase())).size;
  const updated =
    entries
      .map((entry) => entry.lastSeenAt)
      .sort()
      .at(-1) ?? '';
  const skills = topSkills(entries, 5);
  const sample = entries.length === total ? 'всех' : `${entries.length} на этой странице`;
  return [
    `В разделе ${countLabel(total)}. Из ${sample}: с указанной зарплатой — ${salaried}, ` +
      `удалённых — ${remote}, работодателей — ${employers}.`,
    ...(skills.length > 0 ? [`Чаще всего в требованиях: ${skills.join(', ')}.`] : []),
    ...(updated ? [`Данные проверены ${formatRuDate(updated)}.`] : []),
  ];
}
