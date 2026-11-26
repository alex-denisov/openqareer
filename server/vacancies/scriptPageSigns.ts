/**
 * B643: признаки страницы, у которой список вакансий рисует скрипт. Такую
 * страницу каскад читает как ноль вакансий, хотя в браузере они есть.
 * Чистая функция: решает, стоит ли тратить один рендер в браузере.
 */

/** Видимого текста меньше — страница считается пустой оболочкой. */
const SHELL_TEXT_LIMIT = 400;

const MOUNT_NODE = /<div\b[^>]*\bid\s*=\s*["'](?:root|app|__nuxt|__next|q-app)["']/i;
const CLIENT_STATE = /window\.__NUXT__|__NUXT_DATA__|window\.__INITIAL_STATE__/;
const HASH_ANCHOR = /<a\b[^>]*\bhref\s*=\s*["']#["'][^>]*>([\s\S]*?)<\/a>/gi;
const VACANCY_WORDS =
  /ваканси|карьер|открытые позиции|careers?\b|jobs?\b|vacanc|open positions|openings/i;

function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasHashVacancyAnchor(html: string): boolean {
  for (const match of html.matchAll(HASH_ANCHOR)) {
    if (VACANCY_WORDS.test(visibleText(match[1] ?? ''))) return true;
  }
  return false;
}

export function hasScriptPageSigns(html: string): boolean {
  if (!html) return false;
  if (CLIENT_STATE.test(html)) return true;
  if (hasHashVacancyAnchor(html)) return true;
  return MOUNT_NODE.test(html) && visibleText(html).length < SHELL_TEXT_LIMIT;
}
