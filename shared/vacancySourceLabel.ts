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

export function vacancySourceLabel(source: NamedVacancySource): string {
  const name = source.sourceName?.trim();
  if (name) return name;
  return SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType;
}

/** Названия источников кластера без повторов: «rss, rss» — это не два источника. */
export function vacancySourceLabels(
  sources: readonly NamedVacancySource[],
): string[] {
  return [...new Set(sources.map(vacancySourceLabel))];
}
