/**
 * Модуль расчёта базовых значений продуктовых метрик MVP (B320).
 *
 * Все запросы к SQLite выполняются только на чтение (без мутаций, индексов, ALTER).
 * Каждый запрос использует агрегат (COUNT) или явный LIMIT, предотвращая
 * загрузку больших объёмов строк в память процесса.
 */

/**
 * Проверяет наличие таблицы в схеме SQLite.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} tableName
 * @returns {boolean}
 */
export function hasTable(db, tableName) {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return Boolean(row);
}

/**
 * Возвращает список имён колонок таблицы.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} tableName
 * @returns {readonly string[]}
 */
export function getTableColumns(db, tableName) {
  if (!hasTable(db, tableName)) return [];
  /** @type {Array<{ name: string }>} */
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.map((col) => col.name);
}

/**
 * Формирует условие фильтрации пользователей-кандидатов.
 * @param {readonly string[]} userCols
 * @param {boolean} excludeTest
 * @param {string | null | undefined} since
 * @returns {{ readonly sql: string, readonly params: readonly (string | number)[] }}
 */
function buildUserWhere(userCols, excludeTest, since) {
  const clauses = ["u.role = 'candidate'"];
  /** @type {(string | number)[]} */
  const params = [];

  if (since) {
    clauses.push('datetime(u.created_at) >= datetime(?)');
    params.push(since);
  }

  if (excludeTest) {
    clauses.push("u.username NOT LIKE '%.test'");
    if (userCols.includes('email')) {
      clauses.push("(u.email IS NULL OR u.email NOT LIKE '%.test')");
    }
    if (userCols.includes('is_test')) {
      clauses.push('u.is_test = 0');
    }
  }

  return {
    sql: clauses.join(' AND '),
    params: Object.freeze(params),
  };
}

/**
 * Проверяет наличие таблиц для расчёта активации.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string | null}
 */
function checkActivationTables(db) {
  if (!hasTable(db, 'users')) return 'нет таблицы пользователей (users)';
  if (!hasTable(db, 'vacancy_subscriptions')) {
    return 'нет таблицы подписок (vacancy_subscriptions)';
  }
  if (!hasTable(db, 'vacancy_subscription_items')) {
    return 'нет таблицы позиций подписок (vacancy_subscription_items)';
  }
  return null;
}

/**
 * Подсчитывает знаменатель и числитель для активации.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ readonly sql: string, readonly params: readonly (string | number)[] }} userFilter
 * @returns {{ readonly denominator: number, readonly numerator: number }}
 */
function queryActivationCounts(db, userFilter) {
  /** @type {{ total: number }} */
  const denomRow = db
    .prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${userFilter.sql}`)
    .get(...userFilter.params);
  /** @type {{ activeCount: number }} */
  const numRow = db
    .prepare(
      `SELECT COUNT(*) AS activeCount
       FROM users u
       WHERE ${userFilter.sql}
         AND EXISTS (
           SELECT 1
           FROM vacancy_subscriptions vs
           JOIN vacancy_subscription_items vsi ON vsi.subscription_id = vs.id
           WHERE vs.candidate_id = u.candidate_id
         )`,
    )
    .get(...userFilter.params);

  return {
    denominator: denomRow?.total ?? 0,
    numerator: numRow?.activeCount ?? 0,
  };
}

/**
 * Расчёт метрики 1: Активация («профиль → подборка с вакансиями»).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ readonly sql: string, readonly params: readonly (string | number)[] }} userFilter
 * @param {string | null} since
 * @param {string} capturedAt
 */
function calculateActivation(db, userFilter, since, capturedAt) {
  const missingError = checkActivationTables(db);
  if (missingError) {
    return {
      value: null,
      numerator: null,
      denominator: null,
      sampleSize: 0,
      source: missingError,
      since,
      capturedAt,
    };
  }

  const { denominator, numerator } = queryActivationCounts(db, userFilter);
  const value = denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null;

  return {
    value,
    numerator,
    denominator,
    sampleSize: denominator,
    source:
      'users(id, candidate_id, role, created_at), vacancy_subscriptions(id, candidate_id), vacancy_subscription_items(subscription_id, vacancy_id)',
    since,
    capturedAt,
  };
}

/**
 * Вычисляет медиану по упорядоченному запросу со смещением LIMIT/OFFSET.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} fromSql
 * @param {readonly (string | number)[]} params
 * @param {number} count
 * @returns {number}
 */
function queryMedian(db, fromSql, params, count) {
  if (count % 2 === 1) {
    const offset = Math.floor(count / 2);
    /** @type {{ diff_hours: number }} */
    const row = db
      .prepare(`${fromSql} ORDER BY diff_hours ASC LIMIT 1 OFFSET ${offset}`)
      .get(...params);
    return row.diff_hours;
  }
  const offset = count / 2 - 1;
  /** @type {Array<{ diff_hours: number }>} */
  const rows = db
    .prepare(`${fromSql} ORDER BY diff_hours ASC LIMIT 2 OFFSET ${offset}`)
    .all(...params);
  return (rows[0].diff_hours + rows[1].diff_hours) / 2;
}

/**
 * Вычисляет p75 по упорядоченному запросу со смещением LIMIT/OFFSET.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} fromSql
 * @param {readonly (string | number)[]} params
 * @param {number} count
 * @returns {number}
 */
function queryP75(db, fromSql, params, count) {
  const p75Index = 0.75 * (count - 1);
  const lower = Math.floor(p75Index);
  const upper = Math.ceil(p75Index);
  if (lower === upper) {
    /** @type {{ diff_hours: number }} */
    const row = db
      .prepare(`${fromSql} ORDER BY diff_hours ASC LIMIT 1 OFFSET ${lower}`)
      .get(...params);
    return row.diff_hours;
  }
  /** @type {Array<{ diff_hours: number }>} */
  const rows = db
    .prepare(`${fromSql} ORDER BY diff_hours ASC LIMIT 2 OFFSET ${lower}`)
    .all(...params);
  const weight = p75Index - lower;
  return rows[0].diff_hours * (1 - weight) + rows[1].diff_hours * weight;
}

/**
 * Вычисляет медиану и p75 по упорядоченному запросу со смещением LIMIT/OFFSET.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} fromSql
 * @param {readonly (string | number)[]} params
 * @param {number} count
 * @returns {{ readonly median: number | null, readonly p75: number | null }}
 */
function queryPercentiles(db, fromSql, params, count) {
  if (count <= 0) return { median: null, p75: null };
  const rawMedian = queryMedian(db, fromSql, params, count);
  const rawP75 = queryP75(db, fromSql, params, count);
  return {
    median: Math.round(rawMedian * 100) / 100,
    p75: Math.round(rawP75 * 100) / 100,
  };
}

/**
 * Строит подзапрос первых откликов кандидатов.
 * @param {boolean} hasApplications
 * @param {boolean} hasVacancyApplications
 * @returns {{ readonly cte: string, readonly source: string } | null}
 */
function buildApplicationCte(hasApplications, hasVacancyApplications) {
  if (hasApplications && hasVacancyApplications) {
    return {
      cte: `WITH app_union AS (
              SELECT candidate_id, MIN(created_at) AS first_app_at FROM applications GROUP BY candidate_id
              UNION ALL
              SELECT candidate_id, MIN(COALESCE(applied_at, opened_at, updated_at)) AS first_app_at FROM vacancy_applications GROUP BY candidate_id
            ),
            cand_first_app AS (
              SELECT candidate_id, MIN(first_app_at) AS first_app_at FROM app_union GROUP BY candidate_id
            )`,
      source:
        'applications(candidate_id, created_at), vacancy_applications(candidate_id, applied_at, opened_at, updated_at), users(candidate_id, role, created_at)',
    };
  }
  if (hasApplications) {
    return {
      cte: `WITH cand_first_app AS (
              SELECT candidate_id, MIN(created_at) AS first_app_at FROM applications GROUP BY candidate_id
            )`,
      source: 'applications(candidate_id, created_at), users(candidate_id, role, created_at)',
    };
  }
  if (hasVacancyApplications) {
    return {
      cte: `WITH cand_first_app AS (
              SELECT candidate_id, MIN(COALESCE(applied_at, opened_at, updated_at)) AS first_app_at FROM vacancy_applications GROUP BY candidate_id
            )`,
      source:
        'vacancy_applications(candidate_id, applied_at, opened_at, updated_at), users(candidate_id, role, created_at)',
    };
  }
  return null;
}

/**
 * Запрашивает выборку и считает квантили времени до отклика.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} baseFromSql
 * @param {{ readonly sql: string, readonly params: readonly (string | number)[] }} userFilter
 * @param {number} totalCandidates
 */
function queryAppTimingStats(db, baseFromSql, userFilter, totalCandidates) {
  /** @type {{ applicants: number }} */
  const countRow = db
    .prepare(`WITH base_diffs AS (${baseFromSql}) SELECT COUNT(*) AS applicants FROM base_diffs`)
    .get(...userFilter.params);
  const sampleSize = countRow?.applicants ?? 0;
  const withoutApplication = Math.max(0, totalCandidates - sampleSize);

  const { median, p75 } = queryPercentiles(
    db,
    `WITH base_diffs AS (${baseFromSql}) SELECT diff_hours FROM base_diffs`,
    userFilter.params,
    sampleSize,
  );

  return { sampleSize, withoutApplication, median, p75 };
}

/**
 * Расчёт метрики 2: Время до первого отклика (медиана и p75 в часах).
/**
 * Пустой результат замера времени до отклика.
 * @param {string} source
 * @param {string | null} since
 * @param {string} capturedAt
 */
function emptyAppResult(source, since, capturedAt) {
  return {
    value: null,
    median: null,
    p75: null,
    numerator: null,
    denominator: null,
    sampleSize: 0,
    withoutApplication: 0,
    source,
    since,
    capturedAt,
  };
}

/**
 * Расчёт метрики 2: Время до первого отклика (медиана и p75 в часах).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ readonly sql: string, readonly params: readonly (string | number)[] }} userFilter
 * @param {string | null} since
 * @param {string} capturedAt
 */
function calculateTimeToFirstApplication(db, userFilter, since, capturedAt) {
  if (!hasTable(db, 'users')) {
    return emptyAppResult('нет таблицы пользователей (users)', since, capturedAt);
  }

  const appMeta = buildApplicationCte(hasTable(db, 'applications'), hasTable(db, 'vacancy_applications'));
  if (!appMeta) {
    return emptyAppResult('нет таблицы откликов (applications, vacancy_applications)', since, capturedAt);
  }

  /** @type {{ total: number }} */
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${userFilter.sql}`)
    .get(...userFilter.params);
  const totalCandidates = totalRow?.total ?? 0;

  const baseFromSql = `${appMeta.cte}
    SELECT MAX(0.0, (julianday(cfa.first_app_at) - julianday(u.created_at)) * 24.0) AS diff_hours
    FROM cand_first_app cfa
    JOIN users u ON u.candidate_id = cfa.candidate_id
    WHERE ${userFilter.sql}`;

  const stats = queryAppTimingStats(db, baseFromSql, userFilter, totalCandidates);

  return {
    value: stats.median,
    median: stats.median,
    p75: stats.p75,
    numerator: stats.sampleSize,
    denominator: totalCandidates,
    sampleSize: stats.sampleSize,
    withoutApplication: stats.withoutApplication,
    source: appMeta.source,
    since,
    capturedAt,
  };
}

/**
 * Подсчитывает знаменатель и числитель возврата D7.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} d7FilterSql
 * @param {readonly (string | number)[]} d7Params
 * @returns {{ readonly denominator: number, readonly numerator: number }}
 */
function queryD7Counts(db, d7FilterSql, d7Params) {
  /** @type {{ total: number }} */
  const denomRow = db
    .prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${d7FilterSql}`)
    .get(...d7Params);
  /** @type {{ activeCount: number }} */
  const numRow = db
    .prepare(
      `SELECT COUNT(*) AS activeCount
       FROM users u
       WHERE ${d7FilterSql}
         AND EXISTS (
           SELECT 1
           FROM sessions s
           WHERE s.user_id = u.id
             AND (
               (datetime(s.last_seen_at) >= datetime(u.created_at, '+7 days') AND datetime(s.last_seen_at) <= datetime(u.created_at, '+14 days'))
               OR
               (datetime(s.created_at) >= datetime(u.created_at, '+7 days') AND datetime(s.created_at) <= datetime(u.created_at, '+14 days'))
             )
         )`,
    )
    .get(...d7Params);

  return {
    denominator: denomRow?.total ?? 0,
    numerator: numRow?.activeCount ?? 0,
  };
}

/**
 * Расчёт метрики 3: Возврат D7 (активность в интервале [7, 14] дней после регистрации).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ readonly sql: string, readonly params: readonly (string | number)[] }} userFilter
 * @param {string | null} since
 * @param {string} capturedAt
 */
function calculateD7Retention(db, userFilter, since, capturedAt) {
  if (!hasTable(db, 'users')) {
    return {
      value: null,
      numerator: null,
      denominator: null,
      sampleSize: 0,
      source: 'нет таблицы пользователей (users)',
      since,
      capturedAt,
    };
  }
  if (!hasTable(db, 'sessions')) {
    return {
      value: null,
      numerator: null,
      denominator: null,
      sampleSize: 0,
      source: 'нет таблицы сессий (sessions)',
      since,
      capturedAt,
    };
  }

  const d7FilterSql = `${userFilter.sql} AND datetime(u.created_at) <= datetime(?, '-7 days')`;
  const d7Params = Object.freeze([...userFilter.params, capturedAt]);

  const { denominator, numerator } = queryD7Counts(db, d7FilterSql, d7Params);
  const value = denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null;

  return {
    value,
    numerator,
    denominator,
    sampleSize: denominator,
    source: 'sessions(created_at, last_seen_at), users(id, role, created_at)',
    since,
    capturedAt,
  };
}

/**
 * Точка входа в расчёт метрик MVP.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   since?: string | null,
 *   excludeTest?: boolean,
 *   capturedAt?: string
 * }} options
 */
export function computeMvpBaseline(db, options = {}) {
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  const since = options.since ?? null;
  const excludeTest = Boolean(options.excludeTest);

  const userCols = getTableColumns(db, 'users');
  const userFilter = buildUserWhere(userCols, excludeTest, since);

  const activation = calculateActivation(db, userFilter, since, capturedAt);
  const timeToFirstApplication = calculateTimeToFirstApplication(db, userFilter, since, capturedAt);
  const d7Retention = calculateD7Retention(db, userFilter, since, capturedAt);
  const top20Relevance = {
    value: null,
    numerator: null,
    denominator: null,
    sampleSize: 0,
    source: 'scripts/measure-strict-top20.mjs',
    since,
    capturedAt,
  };

  const metrics = Object.freeze({
    activation,
    timeToFirstApplication,
    d7Retention,
    top20Relevance,
  });

  return Object.freeze({
    capturedAt,
    since,
    excludeTest,
    activation,
    timeToFirstApplication,
    d7Retention,
    top20Relevance,
    metrics,
  });
}
