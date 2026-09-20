/**
 * Индексы под подбор кандидату (B229). Без них `ORDER BY … LIMIT` над пулом
 * в полмиллиона записей собирал временное дерево из всего пула и читал
 * `search_text` каждой строки (795 МБ на проде): один подбор занимал 55–150 с
 * и держал event loop, так что `/auth/me` и вход отваливались по таймауту.
 * С индексом в порядке сортировки обход останавливается на LIMIT: замер на
 * проде 2026-09-20 — 30–935 мс для реальных ролей.
 *
 * На большом пуле индексы строятся заранее отдельным процессом (8 и 4 с на
 * проде); `IF NOT EXISTS` при старте тогда ничего не стоит.
 */
export const MATCH_ORDER_SCHEMA = `
CREATE INDEX IF NOT EXISTS vacancy_pool_match_recent
  ON vacancy_pool_index(published_ms DESC, id ASC)
  WHERE expired = 0 AND is_active = 1;
CREATE INDEX IF NOT EXISTS vacancy_pool_match_remote
  ON vacancy_pool_index((CASE WHEN is_remote = 1 THEN 1 ELSE 0 END) DESC,
                        published_ms DESC, id ASC)
  WHERE expired = 0 AND is_active = 1;
`;
