import { useEffect, useState } from 'react';
import { hhSectionsRead, type HhResumeEdit, type HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { getHhResumeEdits } from './hhSessionApi';

/**
 * B678: правки выбранного резюме hh.ru. Просим их, когда у выбранного резюме прочитаны разделы;
 * сбой — сообщение с «Повторить»; отклик можно отправить выбранным резюме как есть.
 */
export interface HhResumeEditsState {
  readonly edits: readonly HhResumeEdit[];
  /** Правки этого выбора ещё считаются. */
  readonly loading: boolean;
  /** B787: запрос правок не удался — сообщение и «Повторить», а не тихо пустой список. */
  readonly failed: boolean;
  readonly retry: () => void;
}

export function useHhResumeEdits(vacancyId: string, snapshot: HhResumeSnapshot | null): HhResumeEditsState {
  const [loaded, setLoaded] = useState<{
    readonly key: string;
    readonly edits: readonly HhResumeEdit[];
    readonly failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const selected = snapshot?.selected;
  const base = selected && hhSectionsRead(selected.sections) ? `${vacancyId}:${selected.id}:${snapshot?.readAt ?? ''}` : null;
  const key = base ? `${base}:${attempt}` : null;
  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    const settle = (edits: readonly HhResumeEdit[], failed: boolean) => {
      if (!controller.signal.aborted) setLoaded({ key, edits, failed });
    };
    getHhResumeEdits(vacancyId, controller.signal)
      .then((result) => settle(result.edits, false))
      .catch(() => settle([], true));
    return () => controller.abort();
  }, [vacancyId, key]);
  const current = loaded !== null && loaded.key === key;
  return {
    edits: current ? loaded.edits : [],
    loading: key !== null && !current,
    failed: current && loaded.failed,
    retry: () => setAttempt((value) => value + 1),
  };
}
