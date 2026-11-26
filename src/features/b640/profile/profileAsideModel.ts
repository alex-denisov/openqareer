import { pluralRu } from '../../../../shared/pluralRu';
import type { ResumeVersionStatus } from '../../../../server/domain/resumeVersions';
import { formatGeography, formatSalaryFloor } from '../../career-map/careerConditionsStorage';
import type { SearchConditionsDraft } from '../../career-map/careerScreenTypes';

export interface TermsRow {
  readonly label: string;
  readonly value: string;
}

function formatOf(format: SearchConditionsDraft['format']): string | null {
  const parts = [
    format.remote ? 'удалённо' : null,
    format.hybrid ? 'гибрид' : null,
    format.office ? 'офис' : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' или ') : null;
}

/** Условия поиска (макет s01): без значения условие поиск не ограничивает — строки нет. */
export function termsRows(
  roles: readonly string[],
  conditions: SearchConditionsDraft,
): readonly TermsRow[] {
  const salary = formatSalaryFloor(conditions.salaryFrom.amountRubles);
  const rows: readonly (readonly [string, string | null])[] = [
    ['Роль', roles[0]?.trim() || null],
    ['Деньги', salary ? `от ${salary} на руки` : null],
    ['Где', formatGeography(conditions.geography.selected)],
    ['Формат', formatOf(conditions.format)],
  ];
  return rows.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}

/**
 * B645 23.11: роль поиска по-русски, как на «Карьере», — если её назвала платформа (модель или
 * онтология) и русское название есть. Роль из резюме кандидата — его слова: как есть.
 */
export function searchRole(
  roles: { readonly value: readonly string[]; readonly origin: string },
  titlesRu: Readonly<Record<string, string>> = {},
): string | null {
  const role = roles.value[0]?.trim();
  if (!role) return null;
  return roles.origin === 'profile' ? role : (titlesRu[role] ?? role);
}

/** Свёрнутая строка условий на телефоне: роль, деньги и место. */
export function termsSummary(rows: readonly TermsRow[]): string {
  return rows
    .filter((row) => row.label !== 'Формат')
    .map((row) => row.value)
    .join(' · ');
}

export interface VersionTag {
  readonly tone: 'part' | 'ok';
  readonly text: string;
}

const TAGS: Readonly<Record<ResumeVersionStatus, VersionTag>> = {
  draft: { tone: 'part', text: 'черновик' },
  approved: { tone: 'ok', text: 'одобрено' },
  sent: { tone: 'ok', text: 'отправлено' },
};

export function versionTag(status: ResumeVersionStatus): VersionTag {
  return TAGS[status];
}

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Moscow',
});

export function versionDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DAY_MONTH.format(date);
}

export function answerLabel(count: number): string {
  return `Ответить на ${pluralRu(count, ['вопрос', 'вопроса', 'вопросов'])}`;
}

/** Ссылка на остальные резюме под вакансии; все показаны — ссылки нет. */
export function moreVersionsLabel(total: number, shown: number): string | null {
  const rest = total - shown;
  return rest > 0 ? `Ещё ${rest} — в «Откликах»` : null;
}
