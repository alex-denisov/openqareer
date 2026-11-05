/**
 * Как называется источник вакансии на экране.
 *
 * Кандидат проверяет запись источником: по нему он решает, идти ли на площадку
 * и доверять ли дате. До этого под вакансией стоял тип транспорта — «json_api»,
 * «rss, rss» (PRB-017), — который не называет ни площадку, ни владельца данных.
 * Название приходит из реестра источников вместе с записью; для записей,
 * снятых до этой правки, остаётся имя типа, а не сырой `json_api`.
 */

export interface NamedVacancySource {
  readonly sourceType: string;
  readonly sourceName?: string;
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  hh: 'hh.ru',
  remotive: 'Remotive',
  telegram: 'Telegram-каналы',
  trudvsem: 'ТрудВсем',
  rss: 'RSS-лента',
  json_api: 'Открытый API',
  html: 'Страница вакансий',
};

/**
 * B446-r (A8), Д2: пометка в скобках («Himalayas (JSON API)», «hh.ru (страница
 * поиска)», «LinkedIn (пул аккаунтов)») — внутреннее различие сбора; кандидат
 * видит площадку. Единственное место, где имя источника чистится для показа;
 * ключи и имена реестра не меняются, админка показывает их как есть.
 */
const INTERNAL_NOTE = /\s*\([^)]*\)\s*$/u;

export function vacancySourceDisplayName(name: string): string {
  return name.replace(INTERNAL_NOTE, '').trim() || name.trim();
}

export function vacancySourceLabel(source: NamedVacancySource): string {
  const name = source.sourceName ? vacancySourceDisplayName(source.sourceName) : '';
  if (name) return name;
  return SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType;
}

/** Названия источников кластера без повторов: «rss, rss» — это не два источника. */
export function vacancySourceLabels(
  sources: readonly NamedVacancySource[],
): string[] {
  return [...new Set(sources.map(vacancySourceLabel))];
}
