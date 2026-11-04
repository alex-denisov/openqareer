import type { DatabaseSync } from 'node:sqlite';

/**
 * Отдельная позиция ролей в очереди текста hh (04.11). Фаза ролей шла в общем обходе перед
 * каталогом и пулом, и когда обход ушёл в пул (полмиллиона строк, больше недели), строки ролей
 * кандидатов ждали его конца: из 1 061 короткой строки подборки владельца за 25 минут текст
 * получила одна. Теперь у ролей своя позиция, и воркер берёт её первой на каждом такте.
 *
 * Запрос идёт по коду функции через индекс `vacancy_semantic_match`: общий запрос с OR по целям
 * сортировал весь срез hh и занимал 3,7–4,6 с на странице (прод), на такте раз в 3 с так нельзя.
 */

export interface HhTextRoleTarget {
  readonly codes: readonly string[];
  readonly floor: number | null;
}

export interface HhRoleTextPage {
  readonly ids: string[];
  readonly position: string;
}

/** Строк просматривается за такт: половина из них уже с текстом, порция тика набирается. */
const HH_TEXT_ROLE_SCAN_PER_TICK = 400;
const HH_TEXT_ROLE_PAGE = 100;
/** После полного прохода позиция отдыхает: такт идёт в общий обход, а не по готовым строкам. */
export const HH_TEXT_ROLE_REST_MS = 10 * 60 * 1_000;

const REST_PREFIX = 'rest|';
const NEWEST = { ms: Number.MAX_SAFE_INTEGER, id: '' };

interface RoleRow {
  readonly id: string;
  readonly ms: number;
}

/** Один код: самая мягкая граница уровня среди целей с этим кодом; `null` — без границы. */
export function floorsByFunction(targets: readonly HhTextRoleTarget[]): Map<string, number | null> {
  const floors = new Map<string, number | null>();
  for (const target of targets) {
    for (const code of target.codes) {
      const known = floors.get(code);
      if (known === undefined) floors.set(code, target.floor);
      else if (known === null || target.floor === null) floors.set(code, null);
      else floors.set(code, Math.min(known, target.floor));
    }
  }
  return floors;
}

function parsePosition(position: string | undefined): RoleRow {
  if (!position) return { ms: NEWEST.ms, id: NEWEST.id };
  const [ms, ...id] = position.split('|');
  const parsed = Number(ms);
  return Number.isFinite(parsed) ? { ms: parsed, id: id.join('|') } : { ms: NEWEST.ms, id: NEWEST.id };
}

function functionPage(
  database: DatabaseSync,
  sourceId: string,
  code: string,
  floor: number | null,
  at: RoleRow,
): RoleRow[] {
  const level = floor === null ? '' : 'AND (s.level_rank >= ? OR s.level_rank IS NULL)';
  // CROSS JOIN keeps the planner on the semantic index: its order needs no sort.
  return database
    .prepare(
      `SELECT s.id AS id, s.published_ms AS ms
         FROM vacancy_semantic s INDEXED BY vacancy_semantic_match
         CROSS JOIN vacancy_pool_index i ON i.id = s.id
        WHERE s.function_code = ? ${level}
          AND (s.published_ms < ? OR (s.published_ms = ? AND s.id > ?))
          AND i.source_id = ? AND i.expired = 0
        ORDER BY s.published_ms DESC, s.id ASC
        LIMIT ?`,
    )
    .all(
      code,
      ...(floor === null ? [] : [floor]),
      at.ms,
      at.ms,
      at.id,
      sourceId,
      HH_TEXT_ROLE_PAGE,
    ) as unknown as RoleRow[];
}

function nextRows(
  database: DatabaseSync,
  sourceId: string,
  floors: ReadonlyMap<string, number | null>,
  at: RoleRow,
): RoleRow[] {
  return [...floors]
    .flatMap(([code, floor]) => functionPage(database, sourceId, code, floor, at))
    .sort((a, b) => b.ms - a.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, HH_TEXT_ROLE_PAGE);
}

/** Следующие строки ролей без текста и позиция после них; строки не читаются дальше порции. */
export function loadRoleTextPage(input: {
  readonly database: DatabaseSync;
  readonly sourceId: string;
  readonly targets: readonly HhTextRoleTarget[];
  readonly position: string | undefined;
  readonly limit: number;
  readonly nowMs: number;
  readonly needsText: (id: string) => boolean;
}): HhRoleTextPage {
  const { position, nowMs } = input;
  const resting = position?.startsWith(REST_PREFIX);
  if (resting && Number(position!.slice(REST_PREFIX.length)) > nowMs) return { ids: [], position: position! };
  const floors = floorsByFunction(input.targets);
  let at = resting ? { ms: NEWEST.ms, id: NEWEST.id } : parsePosition(position);
  const ids: string[] = [];
  let scanned = 0;
  while (ids.length < input.limit && scanned < HH_TEXT_ROLE_SCAN_PER_TICK) {
    const rows = nextRows(input.database, input.sourceId, floors, at);
    if (rows.length === 0) {
      // A page with ids comes first; the rest starts when a walk finds nothing further.
      return { ids, position: `${REST_PREFIX}${nowMs + HH_TEXT_ROLE_REST_MS}` };
    }
    for (const row of rows) {
      scanned += 1;
      at = row;
      if (input.needsText(row.id)) ids.push(row.id);
      if (ids.length >= input.limit) break;
    }
  }
  return { ids, position: `${at.ms}|${at.id}` };
}
