/**
 * Снимок кандидата уезжает частями, которые маршрут доносит.
 *
 * `GET /api/v1/candidate/me` отдавал 59 561 байт, а до браузера доходило
 * 20 469: «Главная», очередь подтверждений и досье оставались пустыми при
 * полной базе (INC-030). Бюджет тот же, что у подбора вакансий и у частей
 * релизных ассетов, — 12 288 байт: размер, который доказанно доезжает.
 *
 * Первый ответ несёт то, из чего собран экран: сам кандидат, досье, резюме,
 * оценки и первая страница памяти. Диалог не едет вовсе — его читает только
 * панель эксперта, и она спрашивает его отдельно. Ходы едут последние: экран
 * показывает свежий, а не первый.
 */
export const SNAPSHOT_PAGE_BYTE_BUDGET = 12_288;

/** Столько последних ходов достаточно всем экранам кабинета. */
const RECENT_TURNS = 3;

export interface SnapshotCollectionMeta {
  readonly total: number;
  readonly nextOffset: number | null;
}

export interface SnapshotHeadMeta {
  readonly memory: SnapshotCollectionMeta;
  readonly messages: SnapshotCollectionMeta;
  readonly turns: SnapshotCollectionMeta;
}

interface PageableSnapshot {
  memory: unknown[];
  messages: unknown[];
  turns: unknown[];
}

export interface BytesPage<T> {
  readonly items: T[];
  readonly total: number;
  readonly offset: number;
  readonly nextOffset: number | null;
}

/** Страница списка, помещающаяся в один доезжающий ответ. */
export function pageByBytes<T>(
  all: readonly T[],
  offset: number,
  budgetBytes: number = SNAPSHOT_PAGE_BYTE_BUDGET,
): BytesPage<T> {
  const start = Math.max(0, Math.trunc(offset));
  const items: T[] = [];
  let size = 2;
  for (let index = start; index < all.length; index += 1) {
    const cost = Buffer.byteLength(JSON.stringify(all[index]), 'utf8') + 1;
    if (items.length > 0 && size + cost > budgetBytes) break;
    items.push(all[index]);
    size += cost;
  }
  const nextOffset = start + items.length;
  return {
    items,
    total: all.length,
    offset: start,
    nextOffset: nextOffset < all.length ? nextOffset : null,
  };
}

/** Диалог кандидата страницами — он не едет в снимке. */
export function buildMessagePage<T>(messages: readonly T[], offset: number): BytesPage<T> {
  return pageByBytes(messages, offset);
}

export function buildSnapshotHead<T extends PageableSnapshot>(
  snapshot: T,
  memoryOffset: number,
  budgetBytes: number = SNAPSHOT_PAGE_BYTE_BUDGET,
): { data: T; meta: SnapshotHeadMeta } {
  const start = Math.max(0, Math.trunc(memoryOffset));
  const turns = snapshot.turns.slice(Math.max(0, snapshot.turns.length - RECENT_TURNS));
  const base = { ...snapshot, memory: [], messages: [], turns } as T;

  let size = Buffer.byteLength(JSON.stringify(base), 'utf8');
  const memory: unknown[] = [];
  for (let index = start; index < snapshot.memory.length; index += 1) {
    const cost = Buffer.byteLength(JSON.stringify(snapshot.memory[index]), 'utf8') + 1;
    // Одна запись уезжает всегда: пустая страница выглядела бы как конец
    // памяти, а память кандидата — это и есть досье.
    if (memory.length > 0 && size + cost > budgetBytes) break;
    memory.push(snapshot.memory[index]);
    size += cost;
  }

  const nextMemoryOffset = start + memory.length;
  return {
    data: { ...base, memory } as T,
    meta: {
      memory: {
        total: snapshot.memory.length,
        nextOffset: nextMemoryOffset < snapshot.memory.length ? nextMemoryOffset : null,
      },
      messages: { total: snapshot.messages.length, nextOffset: null },
      turns: { total: snapshot.turns.length, nextOffset: null },
    },
  };
}
