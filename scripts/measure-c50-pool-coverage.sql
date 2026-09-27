-- C50 / B267. Read-only production measurement; run with sqlite3 DATABASE < this-file.
-- All timestamps use the database host clock. Candidate functions: VP Engineering/
-- Technology, CTO, COO, Head of IT Ops. Region clause is deliberately explicit:
-- remote or a MENA location string; unknown locations are reported separately.
WITH
  candidate(function_code) AS (VALUES ('eng-mgmt'), ('it-ops'), ('ops')),
  settings AS (
    SELECT unixepoch('now') * 1000 AS now_ms, 30 * 24 * 60 * 60 * 1000 AS freshness_ms
  ),
  semantic AS (
    SELECT id, max(level_rank) AS level_rank,
           max(CASE WHEN function_code IN (SELECT function_code FROM candidate) THEN 1 ELSE 0 END) AS candidate_function
    FROM vacancy_semantic GROUP BY id
  ),
  active AS (
    SELECT i.id, i.source_id, i.published_ms, i.is_remote,
           json_extract(p.payload, '$.location') AS location,
           coalesce(json_extract(p.payload, '$.description'), '') AS description,
           s.id IS NOT NULL AS has_title_parse, s.candidate_function, s.level_rank
    FROM vacancy_pool_index i
    JOIN vacancy_pool p ON p.id = i.id
    LEFT JOIN semantic s ON s.id = i.id
    WHERE i.expired = 0 AND i.is_active = 1
  ),
  classified AS (
    SELECT *,
      CASE WHEN is_remote = 1 OR lower(coalesce(location, '')) GLOB '*uae*'
        OR lower(coalesce(location, '')) GLOB '*united arab emirates*'
        OR lower(coalesce(location, '')) GLOB '*dubai*'
        OR lower(coalesce(location, '')) GLOB '*abu dhabi*'
        OR lower(coalesce(location, '')) GLOB '*saudi arabia*'
        OR lower(coalesce(location, '')) GLOB '*riyadh*'
        OR lower(coalesce(location, '')) GLOB '*qatar*'
        OR lower(coalesce(location, '')) GLOB '*egypt*'
        OR lower(coalesce(location, '')) GLOB '*morocco*'
        OR lower(coalesce(location, '')) GLOB '*jordan*'
        OR lower(coalesce(location, '')) GLOB '*lebanon*'
        OR lower(coalesce(location, '')) GLOB '*bahrain*'
        OR lower(coalesce(location, '')) GLOB '*kuwait*'
        OR lower(coalesce(location, '')) GLOB '*oman*' THEN 1 ELSE 0 END AS mena_or_remote
    FROM active
  )
SELECT 'funnel' AS report, 'active' AS stage, count(*) AS vacancies FROM classified
UNION ALL SELECT 'funnel', 'with vacancy_semantic', count(*) FROM classified WHERE has_title_parse
UNION ALL SELECT 'funnel', 'candidate function', count(*) FROM classified WHERE candidate_function = 1
UNION ALL SELECT 'funnel', 'level +/-1 (rank 3-5)', count(*) FROM classified WHERE candidate_function = 1 AND level_rank BETWEEN 3 AND 5
UNION ALL SELECT 'funnel', 'MENA or remote', count(*) FROM classified WHERE candidate_function = 1 AND mena_or_remote = 1
UNION ALL SELECT 'funnel', 'freshness 30 days', count(*) FROM classified, settings WHERE candidate_function = 1 AND published_ms BETWEEN now_ms - freshness_ms AND now_ms
UNION ALL SELECT 'funnel', 'all candidate constraints', count(*) FROM classified, settings WHERE candidate_function = 1 AND level_rank BETWEEN 3 AND 5 AND mena_or_remote = 1 AND published_ms BETWEEN now_ms - freshness_ms AND now_ms
ORDER BY vacancies DESC;

WITH semantic AS (
  SELECT id, max(level_rank) AS level_rank, count(*) AS function_count FROM vacancy_semantic GROUP BY id
), source_rows AS (
  SELECT i.id, i.source_id, i.is_remote, json_extract(p.payload, '$.location') AS location,
    coalesce(json_extract(p.payload, '$.description'), '') AS description,
    s.id IS NOT NULL AS has_title_parse, s.function_count, s.level_rank
  FROM vacancy_pool_index i JOIN vacancy_pool p ON p.id = i.id
  LEFT JOIN semantic s ON s.id = i.id WHERE i.expired = 0 AND i.is_active = 1
)
SELECT source_id, count(*) AS active,
  round(100.0 * sum(NOT has_title_parse) / count(*), 2) AS pct_without_title_parse,
  round(100.0 * sum(coalesce(function_count, 0) = 0) / count(*), 2) AS pct_without_function,
  round(100.0 * sum(level_rank IS NULL) / count(*), 2) AS pct_without_level,
  round(100.0 * sum(is_remote IS NOT 1 AND nullif(trim(coalesce(location, '')), '') IS NULL) / count(*), 2) AS pct_without_country_or_remote,
  round(100.0 * sum(length(trim(description)) = 0) / count(*), 2) AS pct_empty_description,
  round(100.0 * sum(length(trim(description)) = 300) / count(*), 2) AS pct_description_exactly_300_chars
FROM source_rows GROUP BY source_id ORDER BY active DESC, source_id;
