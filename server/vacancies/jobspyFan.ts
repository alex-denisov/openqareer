/**
 * Веер запросов для Indeed и LinkedIn (B218, срез 2).
 *
 * ПОЧЕМУ ВЕЕР, А НЕ ГЛУБОКОЕ ЧТЕНИЕ. Обе площадки отдают ограниченную выдачу
 * на один запрос, и упираются в неё задолго до конца своей базы: Indeed —
 * 968 записей (10 страниц, дальше курсора нет), LinkedIn — 550 карточек
 * (`start=550` уже пуст). Замер с прод-VM 2026-09-14. Поэтому «максимум
 * вакансий» даёт не больший бюджет страниц, а набор разных запросов:
 * «роль × город». Каждая комбинация — своя выдача до потолка.
 *
 * Окно комбинаций сдвигается по кругу от времени, как у TheMuse: один опрос
 * читает свою порцию, а за сутки веер проходится целиком. Чтение всегда
 * частичное — движок дополняет срез, а не заменяет его.
 */

/**
 * Роли, где резюме имеет значение. Массовые профессии исключены по решению
 * владельца (B216): повар, водитель, курьер, уборщик и подобные.
 */
export const FAN_TERMS: readonly string[] = [
  'software engineer',
  'data engineer',
  'data analyst',
  'data scientist',
  'machine learning engineer',
  'devops engineer',
  'security engineer',
  'qa engineer',
  'mobile developer',
  'frontend developer',
  'backend developer',
  'product manager',
  'project manager',
  'business analyst',
  'ux designer',
  'graphic designer',
  'marketing manager',
  'content strategist',
  'sales manager',
  'account executive',
  'customer success manager',
  'financial analyst',
  'accountant',
  'hr manager',
  'recruiter',
  'operations manager',
  'technical writer',
  'consultant',
];

/** Рынки, которые площадки различают. «United States» — общенациональная выдача. */
export const FAN_LOCATIONS: readonly string[] = [
  'United States',
  'New York, NY',
  'San Francisco, CA',
  'Seattle, WA',
  'Austin, TX',
  'Boston, MA',
  'Chicago, IL',
  'Los Angeles, CA',
  'Denver, CO',
  'Atlanta, GA',
  'Remote',
];

export interface FanCombo {
  readonly term: string;
  readonly location: string;
}

/**
 * Комбинации в порядке «каждая роль по всем городам». Перебор идёт ролями
 * внутри города, чтобы соседние комбинации одного опроса не были одной ролью
 * в одиннадцати городах — так порция опроса разнообразнее.
 */
export function fanCombos(
  terms: readonly string[] = FAN_TERMS,
  locations: readonly string[] = FAN_LOCATIONS,
): FanCombo[] {
  const combos: FanCombo[] = [];
  for (const location of locations) {
    for (const term of terms) combos.push({ term, location });
  }
  return combos;
}

export const FAN_SIZE = FAN_TERMS.length * FAN_LOCATIONS.length;

/**
 * С какой комбинации начинает этот опрос: окно сдвигается по кругу от времени,
 * поэтому за сутки веер проходится целиком и ни одна комбинация не остаётся
 * непрочитанной.
 */
export function fanStartIndex(nowMs: number, intervalMinutes: number, combosPerSync: number): number {
  const windows = Math.max(1, Math.ceil(FAN_SIZE / Math.max(1, combosPerSync)));
  const tick = Math.floor(nowMs / (intervalMinutes * 60_000));
  return ((tick % windows) * combosPerSync) % FAN_SIZE;
}
