import type { LinkedinQueueItem, LinkedinRhythm } from '../../../../../shared/b640LinkedinQueue';
import { useLoad } from '../../today/useLoad';
import { getRhythm, listQueue } from './linkedinQueueApi';

export interface CommentPlan {
  readonly rhythm: LinkedinRhythm;
  /** Вся очередь страницы: для «Сегодня осталось» считаются и опубликованные сегодня. */
  readonly items: readonly LinkedinQueueItem[];
  /** Комментарии, которые ждут публикации (`queued`, `due`), по времени. */
  readonly waiting: readonly LinkedinQueueItem[];
}

async function readPlan(): Promise<CommentPlan | null> {
  const [rhythm, queue] = await Promise.all([getRhythm(), listQueue()]);
  if (!rhythm?.comments) return null;
  const waiting = queue.items.filter(
    (item) => item.kind === 'comment' && (item.state === 'queued' || item.state === 'due'),
  );
  return { rhythm, items: queue.items, waiting };
}

/** a05: ритм и очередь комментариев; нет данных — блок не показываем, лента от этого не падает. */
export function useCommentPlan() {
  const load = useLoad(readPlan);
  return { plan: load.state === 'ready' ? load.data : null, reload: load.retry };
}
