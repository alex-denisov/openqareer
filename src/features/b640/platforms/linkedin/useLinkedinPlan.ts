import type { LinkedinRhythm } from '../../../../../shared/b640LinkedinQueue';
import { useLoad } from '../../today/useLoad';
import { getRhythm, listQueue } from './linkedinQueueApi';

export interface LinkedinPlan {
  /** Слот очереди по номеру черновика: когда кандидату напомнят опубликовать. */
  readonly slots: ReadonlyMap<string, string>;
  readonly rhythm: LinkedinRhythm | null;
}

const EMPTY: LinkedinPlan = { slots: new Map(), rhythm: null };

/** План публикаций: нет данных — блок не показываем, экран от этого не падает. */
async function readPlan(): Promise<LinkedinPlan> {
  const [queue, rhythm] = await Promise.all([
    listQueue().catch(() => null),
    getRhythm().catch(() => null),
  ]);
  const slots = new Map(
    (queue?.items ?? [])
      .filter((item) => item.state === 'queued' || item.state === 'due')
      .map((item) => [item.draftId, item.scheduledAt] as const),
  );
  return { slots, rhythm };
}

export function useLinkedinPlan() {
  const load = useLoad(readPlan);
  return { plan: load.state === 'ready' ? load.data : EMPTY, retry: load.retry };
}

/** «не больше 1 поста в неделю»: из ритма кандидата. */
export function rhythmText(rhythm: LinkedinRhythm | null): string | null {
  if (!rhythm) return null;
  const count = rhythm.postsPerWeek;
  const word = count === 1 ? 'поста' : 'постов';
  return `не больше ${count} ${word} в неделю`;
}
