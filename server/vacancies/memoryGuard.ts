import { getHeapStatistics } from 'node:v8';

/**
 * Сторож памяти для опросов источников (B220).
 *
 * ЗАЧЕМ. Движок держит весь пул вакансий в куче Node: 134 557 записей — пик
 * 1,4 ГБ на VM с 1,9 ГБ (прод 2026-09-15), а набор ролей hh.ru владельца
 * держит 452 721 запись. Пока пул не переложен в базу (B221), рост пула
 * упирается в OOM — и служба падала бы посреди обхода, унося с собой всё.
 *
 * ЭТО НЕ ОБРЕЗКА ПУЛА. Сторож ничего не выбрасывает и не режет: выше порога
 * он приостанавливает *опросы*, и пул замирает на достигнутом, а причина
 * называется вслух в журнале и в `/api/v1/health`. Честная остановка вместо
 * падения — безопасная сторона отказа.
 *
 * ГИСТЕРЕЗИС. Порог включения выше порога выключения: сборщик мусора
 * колеблет `heapUsed` на десятки мегабайт, и без зазора опросы дребезжали бы
 * «пауза — идём — пауза» каждый тик.
 */

/** Доля предела кучи, выше которой опросы приостанавливаются. */
export const INGEST_PAUSE_RATIO = 0.75;

/** Доля предела кучи, ниже которой опросы возобновляются. */
export const INGEST_RESUME_RATIO = 0.65;

export interface HeapReading {
  readonly heapUsedBytes: number;
  readonly heapLimitBytes: number;
}

export interface MemoryVerdict {
  readonly paused: boolean;
  /** Состояние изменилось по сравнению с прошлой проверкой. */
  readonly changed: boolean;
  readonly usedRatio: number;
  readonly heapUsedMb: number;
  readonly heapLimitMb: number;
  readonly reason?: string;
}

const MB = 1024 * 1024;

export class MemoryGuard {
  private paused = false;

  constructor(private readonly readHeap: () => HeapReading) {}

  public check(): MemoryVerdict {
    const heap = this.readHeap();
    // Неизвестный предел — это отсутствие сторожа, а не вечная пауза.
    const usedRatio = heap.heapLimitBytes > 0 ? heap.heapUsedBytes / heap.heapLimitBytes : 0;
    const wasPaused = this.paused;
    if (!wasPaused && usedRatio >= INGEST_PAUSE_RATIO) this.paused = true;
    if (wasPaused && usedRatio <= INGEST_RESUME_RATIO) this.paused = false;

    const heapUsedMb = Math.round(heap.heapUsedBytes / MB);
    const heapLimitMb = Math.round(heap.heapLimitBytes / MB);
    return {
      paused: this.paused,
      changed: this.paused !== wasPaused,
      usedRatio,
      heapUsedMb,
      heapLimitMb,
      ...(this.paused
        ? {
            reason: `heap ${heapUsedMb} МБ из ${heapLimitMb} МБ: опросы источников приостановлены, пул не растёт (B220)`,
          }
        : {}),
    };
  }

  /** Последнее решение без нового замера — для `/health`. */
  public get isPaused(): boolean {
    return this.paused;
  }
}

/** Куча процесса: предел — тот, что задан `--max-old-space-size`. */
export function readProcessHeap(): HeapReading {
  const stats = getHeapStatistics();
  return { heapUsedBytes: stats.used_heap_size, heapLimitBytes: stats.heap_size_limit };
}
