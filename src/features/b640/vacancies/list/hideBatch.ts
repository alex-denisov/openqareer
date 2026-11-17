import { hideVacancy } from '../skipApi';
import type { HideEntry } from './triageModel';

const BATCH = 8;

export interface HideOutcome {
  readonly done: readonly HideEntry[];
  /** Id вакансий, которые скрыть не удалось. */
  readonly failed: readonly string[];
}

/** Скрывает серию пачками: не заваливает сервер сотней запросов, сбой одной не прерывает остальные. */
export async function hideInBatches(entries: readonly HideEntry[]): Promise<HideOutcome> {
  const done: HideEntry[] = [];
  const failed: string[] = [];
  for (let start = 0; start < entries.length; start += BATCH) {
    const batch = entries.slice(start, start + BATCH);
    const results = await Promise.allSettled(
      batch.map((entry) => hideVacancy(entry.item.cluster.id, entry.reason)),
    );
    results.forEach((result, index) => {
      const entry = batch[index]!;
      if (result.status === 'fulfilled') done.push(entry);
      else failed.push(entry.item.cluster.id);
    });
  }
  return { done, failed };
}
