import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_35, VACANCY_CLUSTER_INPUT_TABLE, VACANCY_POOL_INDEX_TABLE } from '../data/sqliteSchema';
import { buildSemanticMatchQuery } from './semanticMatchQuery';

/**
 * Замер на реалистичном объёме (B267 S3, план §5 п.3): 750 тыс. записей
 * `vacancy_semantic` с распределением функций как на проде (`eng` ≈ 30 %,
 * `other` ≈ 19 %, `sales` ≈ 10 %, остальное по 1-5 %). Пропускается по
 * умолчанию — вставка 750 тыс. строк не должна тормозить обычный прогон
 * `vitest`; запускается явно `BENCH=1 npx vitest run semanticMatchQuery.bench`.
 *
 * До правки (`IN (...)` + `GROUP BY` по всем функциям сразу, один общий
 * `ORDER BY ... LIMIT`, см. git history этого файла): 957-1542 мс. После
 * правки (ветка UNION ALL на функцию, каждая со своим `ORDER BY published_ms
 * DESC LIMIT` по индексу `vacancy_semantic_match`): 3-9 мс на этом же наборе.
 */
describe.skipIf(!process.env.BENCH)('buildSemanticMatchQuery bench (B267 S3)', () => {
  const ROW_COUNT = 750_000;
  const FUNCTION_WEIGHTS: readonly [string, number][] = [
    ['eng', 0.3],
    ['other', 0.19],
    ['sales', 0.1],
    ['eng-mgmt', 0.05],
    ['it-ops', 0.05],
    ['ops', 0.05],
    ['product', 0.05],
    ['marketing', 0.05],
    ['finance', 0.05],
    ['hr', 0.05],
    ['legal', 0.03],
    ['support', 0.03],
  ];

  function pickFunctionCode(random: number): string {
    let cumulative = 0;
    for (const [code, weight] of FUNCTION_WEIGHTS) {
      cumulative += weight;
      if (random <= cumulative) return code;
    }
    return FUNCTION_WEIGHTS[FUNCTION_WEIGHTS.length - 1][0];
  }

  function seedDatabase(): DatabaseSync {
    const database = new DatabaseSync(':memory:');
    database.exec(MIGRATION_35);
    database.exec(VACANCY_POOL_INDEX_TABLE);
    database.exec(VACANCY_CLUSTER_INPUT_TABLE);
    const now = Date.now();
    const insertSemantic = database.prepare(
      'INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote) VALUES (?,?,?,?,?,?)',
    );
    const insertIndex = database.prepare(
      'INSERT INTO vacancy_pool_index (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired) VALUES (?,?,?,?,1,?,?,?,0)',
    );
    const insertCluster = database.prepare(
      'INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)',
    );
    database.exec('BEGIN');
    for (let i = 0; i < ROW_COUNT; i += 1) {
      const id = `v${i}`;
      const functionCode = pickFunctionCode(Math.random());
      const levelRank = Math.floor(Math.random() * 5);
      const publishedMs = now - Math.floor(Math.random() * 60 * 24 * 60 * 60 * 1000);
      const isRemote = Math.random() < 0.3 ? 1 : 0;
      insertSemantic.run(id, functionCode, levelRank, `title-${i}`, publishedMs, isRemote);
      insertIndex.run(id, 'src', publishedMs, publishedMs, isRemote, `https://x/${id}`, `title ${i}`);
      insertCluster.run(id, JSON.stringify({ id }));
    }
    database.exec('COMMIT');
    database.exec('ANALYZE;');
    return database;
  }

  function timeQuery(
    database: DatabaseSync,
    functionCodes: readonly string[],
    levelRank: number,
  ): number {
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: functionCodes as never,
      levelRank,
      window: { fromMs: 0, toMs: Date.now() },
      preferRemote: false,
      limit: 50,
    });
    const startedAt = performance.now();
    database.prepare(sql).all(...params);
    return performance.now() - startedAt;
  }

  it(
    'отвечает быстрее 300 мс на VP (три функции) и разработчике (массовая функция)',
    () => {
      const database = seedDatabase();
      try {
        const vpMs = timeQuery(database, ['eng-mgmt', 'it-ops', 'ops'], 3);
        const devMs = timeQuery(database, ['eng'], 0);
        // eslint-disable-next-line no-console -- замер только в ручном BENCH-прогоне, не в CI
        console.log(`B267 S3 bench: VP=${vpMs.toFixed(1)}ms, DEV=${devMs.toFixed(1)}ms`);
        expect(vpMs).toBeLessThan(300);
        expect(devMs).toBeLessThan(300);
      } finally {
        database.close();
      }
    },
    // Вставка 750 тыс. строк на медленной CI-машине дольше стандартных 5 с;
    // сам замер запроса печатается в stdout и укладывается в единицы мс.
    120_000,
  );
});
