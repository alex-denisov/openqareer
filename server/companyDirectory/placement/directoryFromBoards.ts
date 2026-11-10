import type { DatabaseSync } from 'node:sqlite';
import type { PlacementType } from './placementLinkage';

/**
 * B643 — доска работодателя вне справочника заводит свою компанию (решение
 * CPO 11.11): amazon, apple, доски Workday и т. п. — работодатели.
 *
 * Строка справочника несёт только имя и происхождение: без ATS, сайта и
 * LinkedIn, поэтому `planCompanyChannels` не заводит по ней второй источник,
 * а поиск сайта (`readPendingCompanies`) её не берёт. Связь с доской живёт в
 * `company_placement`.
 */

export interface BoardRef {
  readonly sourceId: string;
  readonly type: PlacementType;
  readonly slug: string | null;
}

const EVIDENCE_HOW = 'B643 employer board outside directory';

/** Ключ компании из `source_id`: slug доски или имя сайта без `src-` и `-jobs`. */
export function boardCompanyKey(sourceId: string, slug: string | null): string {
  const raw = slug ?? sourceId.replace(/^src-(fh-|company-site-)?/, '').replace(/-(jobs|careers)$/, '');
  return raw.toLowerCase().replace(/[^a-z0-9а-яё]+/g, '-').replace(/^-|-$/g, '');
}

function topCompanyName(database: DatabaseSync, sourceId: string): string | null {
  const row = database.prepare(`SELECT json_extract(c.cluster_json, '$.company') AS name, count(*) AS n
      FROM vacancy_pool_index i JOIN vacancy_cluster_input c ON c.id = i.id
     WHERE i.source_id = ? AND i.expired = 0 GROUP BY 1 ORDER BY n DESC LIMIT 1`).get(sourceId) as
    { name: string | null } | undefined;
  const name = row?.name?.trim();
  return name ? name : null;
}

function ownerOf(database: DatabaseSync, key: string): string | null | undefined {
  const row = database.prepare(`SELECT json_extract(evidence, '$.placement.value') AS source FROM company_directory WHERE company_key = ?`)
    .get(key) as { source: string | null } | undefined;
  return row === undefined ? undefined : row.source;
}

/** Компания для доски; `null` — у доски нет живых вакансий, называть нечем. */
export function adoptBoardCompany(database: DatabaseSync, board: BoardRef, nowIso: string): string | null {
  const base = boardCompanyKey(board.sourceId, board.slug);
  if (!base) return null;
  const suffix = board.sourceId.startsWith('ats-') || board.sourceId.startsWith('src-fh-')
    ? board.sourceId.replace(/^(ats|src-fh)-/, '').split('-')[0]
    : 'site';
  for (const key of [base, `${base}-${suffix}`]) {
    const owner = ownerOf(database, key);
    if (owner === board.sourceId) return key;
    if (owner !== undefined) continue;
    const name = topCompanyName(database, board.sourceId);
    if (!name) return null;
    database.prepare(`INSERT INTO company_directory (company_key, company_name, source_type, status, created_at, updated_at, evidence)
        VALUES (?, ?, ?, 'active', ?, ?, ?)`).run(key, name, board.type === 'ats' ? 'ats_direct' : 'corporate_portal',
      nowIso, nowIso, JSON.stringify({ placement: { value: board.sourceId, how: EVIDENCE_HOW } }));
    return key;
  }
  return null;
}
