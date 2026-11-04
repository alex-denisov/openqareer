/**
 * Зазор между транзакциями записи кластеров (PRB-041). Замер на двух процессах:
 * удержания по 100 мс подряд дают ожидание соседа p95 1043 мс, с зазором 100 мс —
 * p95 143 мс, потому что busy_timeout опрашивает блокировку редко.
 */
export const CLUSTER_WRITE_GAP_MS = 100;

const sleepCell = new Int32Array(new SharedArrayBuffer(4));

/** Ждёт синхронно: запись партии обязана остаться одним тактом цикла событий. */
export function pauseClusterWrite(): void {
  Atomics.wait(sleepCell, 0, 0, CLUSTER_WRITE_GAP_MS);
}
