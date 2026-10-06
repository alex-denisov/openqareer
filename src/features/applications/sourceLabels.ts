/**
 * Человекочитаемые названия источников откликов (B412).
 * Предотвращает появление сырых системных идентификаторов (src-*, ats-*) на экране аналитики.
 */

const KNOWN_EXACT_SOURCES: Record<string, string> = {
  'src-hh-search': 'hh.ru (поиск)',
  'hh-search': 'hh.ru (поиск)',
  'hh.ru (поиск)': 'hh.ru (поиск)',
  hh: 'hh.ru',
  'src-hh': 'hh.ru',
  'hh.ru': 'hh.ru',
  'src-hh-rss': 'hh.ru (RSS)',
  linkedin: 'LinkedIn',
  'src-linkedin': 'LinkedIn',
  'src-linkedin-guest': 'LinkedIn',
  'src-linkedin-crawler': 'LinkedIn',
  indeed: 'Indeed',
  'src-indeed': 'Indeed',
  telegram: 'Telegram-канал',
  'src-telegram': 'Telegram-канал',
  tg: 'Telegram-канал',
  'src-tg': 'Telegram-канал',
  manual: 'Ввод вручную',
  'manual-entry': 'Ввод вручную',
  recruiter: 'Ввод вручную',
  other: 'Другой источник',
};

function capitalizeWord(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Раскладывает id вида ats-<система>-<компания> в «ATS: Система · Компания».
 */
function formatAtsSource(id: string): string | null {
  if (!id.startsWith('ats-')) {
    return null;
  }
  const remainder = id.slice(4).trim();
  if (!remainder) {
    return 'ATS';
  }
  const parts = remainder.split('-').filter(Boolean);
  if (parts.length >= 2) {
    const system = capitalizeWord(parts[0]);
    const company = parts.slice(1).map(capitalizeWord).join(' ');
    return `ATS: ${system} · ${company}`;
  }
  return capitalizeWord(parts[0]);
}

/**
 * Форматирует неизвестный id:
 * отсекает префиксы src- и ats-, заменяет дефисы и подчёркивания на пробелы,
 * переводит первую букву в заглавную.
 */
function formatUnknownSource(id: string): string {
  let cleaned = id.trim();
  if (cleaned.startsWith('src-')) {
    cleaned = cleaned.slice(4);
  } else if (cleaned.startsWith('ats-')) {
    cleaned = cleaned.slice(4);
  }
  cleaned = cleaned.replace(/[-_]+/g, ' ').trim();
  if (!cleaned) {
    return 'Другой источник';
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Возвращает понятную человеку подпись источника вакансии или отклика.
 */
export function humanSourceLabel(rawId: string | null | undefined): string {
  if (!rawId) {
    return 'Другой источник';
  }
  const trimmed = rawId.trim();
  if (!trimmed) {
    return 'Другой источник';
  }

  // 1. Точные известные совпадения
  if (KNOWN_EXACT_SOURCES[trimmed]) {
    return KNOWN_EXACT_SOURCES[trimmed];
  }

  // 2. Telegram-каналы по префиксу
  if (trimmed.startsWith('src-tg-') || trimmed.startsWith('tg-')) {
    return 'Telegram-канал';
  }

  // 3. ATS: <Система> · <Компания>
  const atsFormatted = formatAtsSource(trimmed);
  if (atsFormatted) {
    return atsFormatted;
  }

  // 4. Неизвестный id
  return formatUnknownSource(trimmed);
}
