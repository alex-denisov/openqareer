import { useEffect, useState } from 'react';
import { hhSectionsRead, type HhResumeEdit, type HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { getHhResumeEdits } from './hhSessionApi';

/**
 * B678: правки выбранного резюме hh.ru. Просим их, когда у выбранного резюме прочитаны разделы;
 * сбой — правок нет, отклик уходит выбранным резюме как есть.
 */
export interface HhResumeEditsState {
  readonly edits: readonly HhResumeEdit[];
  /** Правки этого выбора ещё считаются. */
  readonly loading: boolean;
}

export function useHhResumeEdits(vacancyId: string, snapshot: HhResumeSnapshot | null): HhResumeEditsState {
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly edits: readonly HhResumeEdit[] } | null>(null);
  const selected = snapshot?.selected;
  const key = selected && hhSectionsRead(selected.sections) ? `${vacancyId}:${selected.id}:${snapshot?.readAt ?? ''}` : null;
  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    const settle = (edits: readonly HhResumeEdit[]) => {
      if (!controller.signal.aborted) setLoaded({ key, edits });
    };
    getHhResumeEdits(vacancyId, controller.signal)
      .then((result) => settle(result.edits))
      .catch(() => settle([]));
    return () => controller.abort();
  }, [vacancyId, key]);
  const current = loaded !== null && loaded.key === key;
  return { edits: current ? loaded.edits : [], loading: key !== null && !current };
}
