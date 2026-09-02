/**
 * Снимок кандидата уезжает частями, которые маршрут доносит.
 *
 * `GET /api/v1/candidate/me` отдавал 59 561 байт, а до браузера доходило
 * 20 469: «Главная», очередь подтверждений и факты кандидата оставались пустыми при
 * полной базе (INC-030). Бюджет тот же, что у подбора вакансий и у частей
 * релизных ассетов, — 12 288 байт: размер, который доказанно доезжает.
 *
 * Первый ответ несёт то, из чего собран экран: сам кандидат, его факты, резюме,
 * оценки и первая страница памяти. Диалог не едет вовсе — его читает только
 * панель эксперта, и она спрашивает его отдельно. Ходы едут последние и лишь
 * те, что помещаются: один ход коуча несёт весь разбор и сам бывает больше
 * бюджета, поэтому у ходов тоже есть своя страница.
 */
export const SNAPSHOT_PAGE_BYTE_BUDGET = 12_288;

/** Больше трёх последних ходов ни один экран кабинета не читает. */
const RECENT_TURNS = 3;

export interface SnapshotCollectionMeta {
  readonly total: number;
  readonly nextOffset: number | null;
}

export interface SnapshotHeadMeta {
  readonly memory: SnapshotCollectionMeta;
  readonly messages: SnapshotCollectionMeta;
  readonly turns: SnapshotCollectionMeta;
  /** Размер ответа в байтах: бюджет должен быть проверяем снаружи. */
  readonly headBytes: number;
}

interface PageableSnapshot {
  memory: unknown[];
  messages: unknown[];
  turns: unknown[];
  dossier: { sections: unknown[] };
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

/** Память кандидата страницами: голова снимка её не несёт. */
export function buildMemoryPage<T>(memory: readonly T[], offset: number): BytesPage<T> {
  return pageByBytes(memory, offset);
}

/** Диалог кандидата страницами — он не едет в снимке. */
export function buildMessagePage<T>(messages: readonly T[], offset: number): BytesPage<T> {
  return pageByBytes(messages, offset);
}

/**
 * Ходы страницами, от свежего к старому: экранам нужен последний разбор, а не
 * первый, и целиком лента ходов в один ответ не помещается.
 */
export function buildTurnPage<T>(turns: readonly T[], offset: number): BytesPage<T> {
  return pageByBytes([...turns].reverse(), offset);
}

export function buildSnapshotHead<T extends PageableSnapshot>(
  snapshot: T,
  memoryOffset: number,
  budgetBytes: number = SNAPSHOT_PAGE_BYTE_BUDGET,
): { data: T; meta: SnapshotHeadMeta } {
  const start = Math.max(0, Math.trunc(memoryOffset));
  // Разделы фактов — те же записи памяти, разложенные по доменам. Кабинет
  // читает у набора фактов только счётчики и готовность, а разделы весили 14 637 из
  // 18 494 байт головы. Записи приезжают памятью, разделы — нет.
  const empty = {
    ...snapshot,
    memory: [],
    messages: [],
    turns: [],
    dossier: { ...snapshot.dossier, sections: [] },
  } as T;
  // Ход коуча несёт весь разбор — три хода сами по себе перекрывали бюджет.
  // Берём от свежего к старому, пока помещается, но свежий уезжает всегда:
  // без него «Главная» не покажет ни трека, ни следующего действия.
  const turns: unknown[] = [];
  let size = Buffer.byteLength(JSON.stringify(empty), 'utf8');
  for (let index = snapshot.turns.length - 1; index >= 0 && turns.length < RECENT_TURNS; index -= 1) {
    const cost = Buffer.byteLength(JSON.stringify(snapshot.turns[index]), 'utf8') + 1;
    if (size + cost > budgetBytes) break;
    turns.unshift(snapshot.turns[index]);
    size += cost;
  }
  const base = { ...empty, turns } as T;
  const memory: unknown[] = [];
  for (let index = start; index < snapshot.memory.length; index += 1) {
    const cost = Buffer.byteLength(JSON.stringify(snapshot.memory[index]), 'utf8') + 1;
    // Одна запись уезжает всегда: пустая страница выглядела бы как конец
    // памяти, а память кандидата — это и есть его факты.
    if (memory.length > 0 && size + cost > budgetBytes) break;
    memory.push(snapshot.memory[index]);
    size += cost;
  }

  const nextMemoryOffset = start + memory.length;
  const data = { ...base, memory } as T;
  return {
    data,
    meta: {
      memory: {
        total: snapshot.memory.length,
        nextOffset: nextMemoryOffset < snapshot.memory.length ? nextMemoryOffset : null,
      },
      messages: { total: snapshot.messages.length, nextOffset: null },
      // Ходы едут от свежего к старому. Ни одного не влезло — это не «ходов
      // нет»: экран дочитает их своей страницей.
      turns: { total: snapshot.turns.length, nextOffset: turns.length === 0 && snapshot.turns.length > 0 ? 0 : null },
      headBytes: Buffer.byteLength(JSON.stringify(data), 'utf8'),
    },
  };
}
