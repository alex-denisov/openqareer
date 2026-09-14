/**
 * Веер запросов для Indeed и LinkedIn (B218).
 *
 * ПОЧЕМУ ВЕЕР, А НЕ ГЛУБОКОЕ ЧТЕНИЕ. Обе площадки отдают ограниченную выдачу
 * на один запрос и упираются в неё задолго до конца своей базы: Indeed —
 * 968 записей (10 страниц, дальше курсора нет), LinkedIn — 550 карточек
 * (`start=550` уже пуст). Замер с прод-VM 2026-09-14. Поэтому «максимум
 * вакансий» даёт не бюджет страниц, а набор разных запросов: «роль × рынок».
 *
 * ПОЧЕМУ ИМЕННО ЭТИ РЫНКИ. Список регионов — не выдумка сборщика, а тот самый
 * набор, который платформа спрашивает у кандидата
 * (`src/features/workspace/candidateRegions.ts`: ru, cis, us, eu, mena, apac,
 * latam). Плюс удалёнка без привязки к стране, названная владельцем отдельно.
 * Страны внутри региона проверены живым запросом с прод-VM 2026-09-14: каждая
 * отвечает и отдаёт свои вакансии.
 *
 * Окно комбинаций сдвигается по кругу от времени: один опрос читает свою
 * порцию, а за несколько суток веер проходится целиком. Чтение всегда
 * частичное — движок дополняет срез, а не заменяет его.
 */

/** Регионы платформы плюс удалёнка: `global` — рынок без привязки к стране. */
export type FanRegion = 'ru' | 'cis' | 'us' | 'eu' | 'mena' | 'apac' | 'latam' | 'global';

export interface FanTarget {
  readonly region: FanRegion;
  /**
   * Код страны для заголовка `indeed-co` (заглавными — строчные Indeed
   * отвергает). `null` — страны у Indeed нет, рынок читает только LinkedIn.
   */
  readonly indeedCountry: string | null;
  /** Текст локации: его понимают обе площадки. */
  readonly location: string;
}

/**
 * Рынки по регионам платформы. Коды стран проверены живым запросом: все
 * перечисленные отдали вакансии со своей страной в записи.
 *
 * У Indeed нет России (в списке стран её просто нет) — российский рынок
 * закрывает hh.ru (B214), здесь он остаётся за LinkedIn.
 */
export const MARKET_TARGETS: readonly FanTarget[] = [
  // US
  { region: 'us', indeedCountry: 'US', location: 'United States' },
  { region: 'us', indeedCountry: 'US', location: 'New York, NY' },
  { region: 'us', indeedCountry: 'US', location: 'San Francisco, CA' },
  { region: 'us', indeedCountry: 'US', location: 'Seattle, WA' },
  { region: 'us', indeedCountry: 'US', location: 'Austin, TX' },
  { region: 'us', indeedCountry: 'US', location: 'Boston, MA' },
  { region: 'us', indeedCountry: 'US', location: 'Chicago, IL' },
  { region: 'us', indeedCountry: 'US', location: 'Los Angeles, CA' },
  { region: 'us', indeedCountry: 'CA', location: 'Toronto' },
  { region: 'us', indeedCountry: 'CA', location: 'Vancouver' },
  // EU
  { region: 'eu', indeedCountry: 'GB', location: 'London' },
  { region: 'eu', indeedCountry: 'GB', location: 'Manchester' },
  { region: 'eu', indeedCountry: 'DE', location: 'Berlin' },
  { region: 'eu', indeedCountry: 'DE', location: 'Munich' },
  { region: 'eu', indeedCountry: 'FR', location: 'Paris' },
  { region: 'eu', indeedCountry: 'NL', location: 'Amsterdam' },
  { region: 'eu', indeedCountry: 'ES', location: 'Madrid' },
  { region: 'eu', indeedCountry: 'ES', location: 'Barcelona' },
  { region: 'eu', indeedCountry: 'IT', location: 'Milan' },
  { region: 'eu', indeedCountry: 'IE', location: 'Dublin' },
  { region: 'eu', indeedCountry: 'PL', location: 'Warsaw' },
  { region: 'eu', indeedCountry: 'PT', location: 'Lisbon' },
  { region: 'eu', indeedCountry: 'SE', location: 'Stockholm' },
  { region: 'eu', indeedCountry: 'CH', location: 'Zurich' },
  { region: 'eu', indeedCountry: 'AT', location: 'Vienna' },
  { region: 'eu', indeedCountry: 'BE', location: 'Brussels' },
  { region: 'eu', indeedCountry: 'CZ', location: 'Prague' },
  { region: 'eu', indeedCountry: 'RO', location: 'Bucharest' },
  { region: 'eu', indeedCountry: 'DK', location: 'Copenhagen' },
  { region: 'eu', indeedCountry: 'NO', location: 'Oslo' },
  { region: 'eu', indeedCountry: 'FI', location: 'Helsinki' },
  // MENA
  { region: 'mena', indeedCountry: 'AE', location: 'Dubai' },
  { region: 'mena', indeedCountry: 'AE', location: 'Abu Dhabi' },
  { region: 'mena', indeedCountry: 'SA', location: 'Riyadh' },
  { region: 'mena', indeedCountry: 'QA', location: 'Doha' },
  { region: 'mena', indeedCountry: 'KW', location: 'Kuwait City' },
  { region: 'mena', indeedCountry: 'BH', location: 'Manama' },
  { region: 'mena', indeedCountry: 'OM', location: 'Muscat' },
  { region: 'mena', indeedCountry: 'EG', location: 'Cairo' },
  { region: 'mena', indeedCountry: 'MA', location: 'Casablanca' },
  { region: 'mena', indeedCountry: 'IL', location: 'Tel Aviv' },
  { region: 'mena', indeedCountry: 'TR', location: 'Istanbul' },
  // APAC
  { region: 'apac', indeedCountry: 'IN', location: 'Bangalore' },
  { region: 'apac', indeedCountry: 'IN', location: 'Mumbai' },
  { region: 'apac', indeedCountry: 'IN', location: 'Hyderabad' },
  { region: 'apac', indeedCountry: 'SG', location: 'Singapore' },
  { region: 'apac', indeedCountry: 'AU', location: 'Sydney' },
  { region: 'apac', indeedCountry: 'AU', location: 'Melbourne' },
  { region: 'apac', indeedCountry: 'JP', location: 'Tokyo' },
  { region: 'apac', indeedCountry: 'HK', location: 'Hong Kong' },
  { region: 'apac', indeedCountry: 'MY', location: 'Kuala Lumpur' },
  { region: 'apac', indeedCountry: 'PH', location: 'Manila' },
  { region: 'apac', indeedCountry: 'ID', location: 'Jakarta' },
  { region: 'apac', indeedCountry: 'KR', location: 'Seoul' },
  { region: 'apac', indeedCountry: 'NZ', location: 'Auckland' },
  { region: 'apac', indeedCountry: 'VN', location: 'Ho Chi Minh City' },
  { region: 'apac', indeedCountry: 'TH', location: 'Bangkok' },
  // LATAM
  { region: 'latam', indeedCountry: 'BR', location: 'Sao Paulo' },
  { region: 'latam', indeedCountry: 'MX', location: 'Mexico City' },
  { region: 'latam', indeedCountry: 'AR', location: 'Buenos Aires' },
  { region: 'latam', indeedCountry: 'CL', location: 'Santiago' },
  { region: 'latam', indeedCountry: 'CO', location: 'Bogota' },
  { region: 'latam', indeedCountry: 'PE', location: 'Lima' },
  { region: 'latam', indeedCountry: 'UY', location: 'Montevideo' },
  { region: 'latam', indeedCountry: 'CR', location: 'San Jose' },
  // СНГ — у Indeed из СНГ есть только Украина; остальное читает LinkedIn.
  { region: 'cis', indeedCountry: 'UA', location: 'Kyiv' },
  { region: 'cis', indeedCountry: null, location: 'Kazakhstan' },
  { region: 'cis', indeedCountry: null, location: 'Georgia' },
  { region: 'cis', indeedCountry: null, location: 'Armenia' },
  { region: 'cis', indeedCountry: null, location: 'Uzbekistan' },
  { region: 'cis', indeedCountry: null, location: 'Azerbaijan' },
  // Россия — у Indeed страны нет вовсе; основной сбор ведёт hh.ru (B214).
  { region: 'ru', indeedCountry: null, location: 'Russia' },
  { region: 'ru', indeedCountry: null, location: 'Moscow' },
  // Удалёнка без привязки к стране — рынок, названный владельцем отдельно.
  { region: 'global', indeedCountry: 'US', location: 'Remote' },
  { region: 'global', indeedCountry: null, location: 'Worldwide' },
  { region: 'global', indeedCountry: null, location: 'European Union' },
];

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

export interface FanCombo {
  readonly term: string;
  readonly target: FanTarget;
}

export const FAN_SIZE = FAN_TERMS.length * MARKET_TARGETS.length;

/**
 * Комбинация под номером. Рынок меняется на каждом шаге, а роль — раз в круг
 * по рынкам: соседние комбинации одного опроса тогда покрывают разные регионы,
 * а не одну роль в тридцати городах одной страны.
 */
export function fanComboAt(index: number): FanCombo {
  const wrapped = ((index % FAN_SIZE) + FAN_SIZE) % FAN_SIZE;
  const target = MARKET_TARGETS[wrapped % MARKET_TARGETS.length]!;
  const term = FAN_TERMS[Math.floor(wrapped / MARKET_TARGETS.length) % FAN_TERMS.length]!;
  return { term, target };
}

/**
 * С какой комбинации начинает этот опрос: окно сдвигается по кругу от времени,
 * поэтому веер проходится целиком и ни одна комбинация не остаётся
 * непрочитанной.
 */
export function fanStartIndex(
  nowMs: number,
  intervalMinutes: number,
  combosPerSync: number,
): number {
  const windows = Math.max(1, Math.ceil(FAN_SIZE / Math.max(1, combosPerSync)));
  const tick = Math.floor(nowMs / (intervalMinutes * 60_000));
  return ((tick % windows) * combosPerSync) % FAN_SIZE;
}

/** Рынки, которые веер реально покрывает, — для честной подписи в реестре. */
export function fanRegions(): readonly FanRegion[] {
  return [...new Set(MARKET_TARGETS.map((target) => target.region))];
}
