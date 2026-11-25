const ROW_PREFIX = 'cluster-';

/** Вакансия, по которой ищем отправленный отклик. */
export interface SentLookup {
  readonly clusterId: string;
  readonly title?: string;
  readonly urls: readonly (string | null | undefined)[];
}

/** Строка подборки `cluster-<запись>` и сама запись — одна вакансия. */
export function rowIds(id: string): readonly string[] {
  const record = id.startsWith(ROW_PREFIX) ? id.slice(ROW_PREFIX.length) : id;
  return [record, `${ROW_PREFIX}${record}`];
}

/** Объявление: адрес и название. Одного адреса мало — на общей странице бывает несколько вакансий. */
export function postingKey(
  url: string | null | undefined,
  title: string | undefined,
): string | null {
  if (!url?.trim() || !title?.trim()) return null;
  return `${url.trim().replace(/#.*$/u, '').replace(/\/+$/u, '')}\n${title.trim().toLocaleLowerCase('und')}`;
}
