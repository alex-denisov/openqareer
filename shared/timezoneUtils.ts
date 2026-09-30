/**
 * Утилиты проверки и определения часовых поясов IANA (B328).
 *
 * Работает одинаково на клиенте и сервере (чистые функции, Intl.DateTimeFormat).
 * Кандидат и каждый аккаунт пула LinkedIn имеют свой часовой пояс.
 */

export const DEFAULT_ACCOUNT_TIMEZONE = 'Europe/Moscow';

/**
 * Описание часового пояса для списка выбора.
 */
export interface TimezoneOption {
  readonly city: string;
  readonly timezone: string;
}

/**
 * Постоянный упорядоченный список часовых поясов (B332).
 */
export const COMMON_TIMEZONES: readonly TimezoneOption[] = [
  { city: 'Москва', timezone: 'Europe/Moscow' },
  { city: 'Калининград', timezone: 'Europe/Kaliningrad' },
  { city: 'Самара', timezone: 'Europe/Samara' },
  { city: 'Екатеринбург', timezone: 'Asia/Yekaterinburg' },
  { city: 'Новосибирск', timezone: 'Asia/Novosibirsk' },
  { city: 'Красноярск', timezone: 'Asia/Krasnoyarsk' },
  { city: 'Иркутск', timezone: 'Asia/Irkutsk' },
  { city: 'Владивосток', timezone: 'Asia/Vladivostok' },
  { city: 'Минск', timezone: 'Europe/Minsk' },
  { city: 'Киев', timezone: 'Europe/Kyiv' },
  { city: 'Тбилиси', timezone: 'Asia/Tbilisi' },
  { city: 'Ереван', timezone: 'Asia/Yerevan' },
  { city: 'Алматы', timezone: 'Asia/Almaty' },
  { city: 'Ташкент', timezone: 'Asia/Tashkent' },
  { city: 'Дубай', timezone: 'Asia/Dubai' },
  { city: 'Стамбул', timezone: 'Europe/Istanbul' },
  { city: 'Каир', timezone: 'Africa/Cairo' },
  { city: 'Берлин', timezone: 'Europe/Berlin' },
  { city: 'Амстердам', timezone: 'Europe/Amsterdam' },
  { city: 'Лондон', timezone: 'Europe/London' },
  { city: 'Лиссабон', timezone: 'Europe/Lisbon' },
  { city: 'Нью-Йорк', timezone: 'America/New_York' },
  { city: 'Лос-Анджелес', timezone: 'America/Los_Angeles' },
  { city: 'Сингапур', timezone: 'Asia/Singapore' },
  { city: 'Бангкок', timezone: 'Asia/Bangkok' },
] as const;

/**
 * Проверяет, является ли строка валидным идентификатором IANA time zone.
 */
export function isValidTimezone(timezone: unknown): boolean {
  if (typeof timezone !== 'string') return false;
  const trimmed = timezone.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * Вычисляет текущее смещение часового пояса через Intl.DateTimeFormat (вид «UTC+3», «UTC-5», «UTC»).
 */
export function formatTimezoneOffset(timezone: string, date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const offset = tzPart.replace(/^GMT/, '');
    if (!offset || offset === '+0' || offset === '-0' || offset === '+00:00' || offset === '-00:00') {
      return 'UTC';
    }
    return `UTC${offset}`;
  } catch {
    return 'UTC';
  }
}

/**
 * Возвращает название города для часового пояса (из постоянного списка или из строки IANA).
 */
export function getTimezoneCity(timezone: string): string {
  const found = COMMON_TIMEZONES.find((item) => item.timezone === timezone);
  if (found) {
    return found.city;
  }
  const parts = timezone.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

/**
 * Форматирует часовой пояс для отображения: «Москва (UTC+3)» или «<значение> (UTC±N)».
 */
export function formatTimezoneDisplay(timezone?: string | null, date: Date = new Date()): string {
  const tz = timezone?.trim() || DEFAULT_ACCOUNT_TIMEZONE;
  const offset = formatTimezoneOffset(tz, date);
  const found = COMMON_TIMEZONES.find((item) => item.timezone === tz);
  if (found) {
    return `${found.city} (${offset})`;
  }
  return `${tz} (${offset})`;
}

/**
 * Определяет часовой пояс по умолчанию из региона или админ-лейбла аккаунта.
 * Если совпадений нет — возвращает DEFAULT_ACCOUNT_TIMEZONE (Europe/Moscow).
 */
export function inferTimezoneFromRegionOrLabel(labelOrRegion?: string | null): string {
  if (!labelOrRegion || typeof labelOrRegion !== 'string') {
    return DEFAULT_ACCOUNT_TIMEZONE;
  }
  const text = labelOrRegion.trim().toLowerCase();

  // Прямое указание пояса в тексте (например "Europe/Berlin" или "America/New_York")
  if (isValidTimezone(labelOrRegion.trim())) {
    return labelOrRegion.trim();
  }

  // Германия / DACH / Центральная Европа
  if (
    text.includes('германи') ||
    text.includes('germany') ||
    text.includes('berlin') ||
    text.includes('берлин') ||
    text.includes('frankfurt') ||
    text.includes('франкфурт') ||
    /\bde\b/i.test(text)
  ) {
    return 'Europe/Berlin';
  }

  // Нидерланды / Амстердам
  if (
    text.includes('нидерланд') ||
    text.includes('netherlands') ||
    text.includes('holland') ||
    text.includes('amsterdam') ||
    text.includes('амстердам') ||
    /\bnl\b/i.test(text)
  ) {
    return 'Europe/Amsterdam';
  }

  // Великобритания / Лондон
  if (
    text.includes('великобритан') ||
    text.includes('uk') ||
    text.includes('london') ||
    text.includes('лондон') ||
    text.includes('британи') ||
    /\bgb\b/i.test(text)
  ) {
    return 'Europe/London';
  }

  // Кипр / Лимасол
  if (
    text.includes('кипр') ||
    text.includes('cyprus') ||
    text.includes('limassol') ||
    text.includes('лимасол') ||
    text.includes('nicosia') ||
    text.includes('никосия')
  ) {
    return 'Asia/Nicosia';
  }

  // Сербия / Белград
  if (
    text.includes('серби') ||
    text.includes('serbia') ||
    text.includes('belgrade') ||
    text.includes('белград') ||
    /\brs\b/i.test(text)
  ) {
    return 'Europe/Belgrade';
  }

  // ОАЭ / Дубай / Ближний Восток
  if (
    text.includes('оаэ') ||
    text.includes('uae') ||
    text.includes('dubai') ||
    text.includes('дубай') ||
    text.includes('emirates')
  ) {
    return 'Asia/Dubai';
  }

  // Армения / Ереван
  if (
    text.includes('армени') ||
    text.includes('armenia') ||
    text.includes('yerevan') ||
    text.includes('ереван')
  ) {
    return 'Asia/Yerevan';
  }

  // Грузия / Тбилиси
  if (
    text.includes('грузи') ||
    text.includes('georgia') ||
    text.includes('tbilisi') ||
    text.includes('тбилиси')
  ) {
    return 'Asia/Tbilisi';
  }

  // Казахстан / Алматы / Астана
  if (
    text.includes('казахстан') ||
    text.includes('kazakhstan') ||
    text.includes('almaty') ||
    text.includes('алматы') ||
    text.includes('астана') ||
    text.includes('astana') ||
    /\bkz\b/i.test(text)
  ) {
    return 'Asia/Almaty';
  }

  // США / Западное побережье / Калифорния
  if (
    text.includes('california') ||
    text.includes('калифорни') ||
    text.includes('san francisco') ||
    text.includes('сан-франциско') ||
    text.includes('los angeles') ||
    text.includes('seattle')
  ) {
    return 'America/Los_Angeles';
  }

  // США / Нью-Йорк / Восточное побережье
  if (
    text.includes('сша') ||
    text.includes('usa') ||
    text.includes('new york') ||
    text.includes('нью-йорк') ||
    /\bus\b/i.test(text)
  ) {
    return 'America/New_York';
  }

  // Франция / Париж
  if (text.includes('франци') || text.includes('france') || text.includes('paris') || text.includes('париж')) {
    return 'Europe/Paris';
  }

  // Испания / Мадрид / Барселона
  if (text.includes('испани') || text.includes('spain') || text.includes('madrid') || text.includes('barcelona')) {
    return 'Europe/Madrid';
  }

  // Австрия / Швейцария
  if (text.includes('австри') || text.includes('austria') || text.includes('vienna') || text.includes('вена')) {
    return 'Europe/Vienna';
  }
  if (text.includes('швейцари') || text.includes('switzerland') || text.includes('zurich') || text.includes('цюрих')) {
    return 'Europe/Zurich';
  }

  // Польша / Варшава
  if (text.includes('польш') || text.includes('poland') || text.includes('warsaw') || text.includes('варшава')) {
    return 'Europe/Warsaw';
  }

  // Россия / Москва
  if (
    text.includes('москв') ||
    text.includes('moscow') ||
    text.includes('росси') ||
    text.includes('russia') ||
    /\bmow\b/i.test(text) ||
    /\bmsk\b/i.test(text) ||
    /\bru\b/i.test(text)
  ) {
    return 'Europe/Moscow';
  }

  return DEFAULT_ACCOUNT_TIMEZONE;
}

/**
 * Возвращает локальную дату в формате YYYY-MM-DD для заданного пояса.
 */
export function formatLocalDate(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}
