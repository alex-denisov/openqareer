/**
 * Что стоит в поле запроса новой выборки.
 *
 * Роль профиля подставляется один раз — пока кандидат сам ничего не вводил.
 * Прежний эффект «пусто → подставить» возвращал значение после каждого
 * стирания и ронял в поле placeholder на кадр (владелец, 2026-09-20).
 */
export function seededQuery({
  query,
  defaultQuery,
  touched,
}: {
  readonly query: string;
  readonly defaultQuery?: string;
  readonly touched: boolean;
}): string {
  if (query || touched) return query;
  return defaultQuery ?? '';
}
