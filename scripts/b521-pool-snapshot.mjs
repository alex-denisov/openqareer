// B521: one bounded, read-only observation; never opens candidate tables.
import { DatabaseSync } from 'node:sqlite';
const path = process.argv[2];
if (!path) throw new Error('Pass the pool database path explicitly');
const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
try {
  const now = Date.now();
  db.exec('BEGIN');
  const totals = db.prepare(`SELECT count(*) AS total,
    sum(CASE WHEN expired=0 THEN 1 ELSE 0 END) AS alive,
    sum(CASE WHEN expired=0 AND observed_ms>=? THEN 1 ELSE 0 END) AS observedLast24h
    FROM vacancy_pool_index`).get(now - 86400000);
  const sources = db.prepare(`SELECT source_id, count(*) AS alive FROM vacancy_pool_index
    WHERE expired=0 GROUP BY source_id ORDER BY alive DESC`).all();
  const samples = [];
  for (const source of sources.slice(0, 6)) {
    const rows = db.prepare(`SELECT v.id, v.payload FROM vacancy_pool_index i
      JOIN vacancy_pool v ON v.id=i.id WHERE i.source_id=? AND i.expired=0
      ORDER BY i.published_ms DESC, i.id DESC LIMIT 100`).all(source.source_id);
    for (const row of rows) {
      const v = JSON.parse(row.payload);
      samples.push({ id: row.id, source: source.source_id, title: v.title,
        location: v.location ?? null, country: v.country ?? null, isRemote: v.isRemote ?? null,
        description: v.fullDescription ?? v.description ?? '', url: v.url ?? null,
        publishedAt: v.publishedAt ?? null });
    }
  }
  db.exec('COMMIT');
  process.stdout.write(JSON.stringify({ measuredAt: new Date(now).toISOString(), totals, sources, samples }));
} finally { db.close(); }
