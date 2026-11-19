import { useEffect, useState } from 'react';
import type { HhResumeEdit, HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { getHhResumeEdits } from './hhSessionApi';

/**
 * B678: правки выбранного резюме hh.ru. Просим их, когда у выбранного резюме прочитаны разделы;
 * сбой — правок нет, отклик уходит выбранным резюме как есть.
 */
export function useHhResumeEdits(vacancyId: string, snapshot: HhResumeSnapshot | null): readonly HhResumeEdit[] {
  const [edits, setEdits] = useState<readonly HhResumeEdit[]>([]);
  const selected = snapshot?.selected;
  const key = selected?.sections ? `${selected.id}:${snapshot?.readAt ?? ''}` : null;
  useEffect(() => {
    setEdits([]);
    if (!key) return undefined;
    const controller = new AbortController();
    getHhResumeEdits(vacancyId, controller.signal)
      .then((result) => setEdits(result.edits))
      .catch(() => setEdits([]));
    return () => controller.abort();
  }, [vacancyId, key]);
  return edits;
}
