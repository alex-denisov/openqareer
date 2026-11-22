/** B737: русские названия ролей поиска из ответа кампании (`titlesRu`), ключ — исходное название. */
export type RoleTitlesRu = Readonly<Record<string, string>>;

/** Название роли для кандидата: русское, если оно есть, иначе исходное. */
export function roleLabel(title: string, titlesRu: RoleTitlesRu = {}): string {
  return titlesRu[title] || title;
}
