import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '../../kit';
import type { HiddenRow } from '../b640Api';
import { hideInBatches } from './hideBatch';
import type { HideMany } from './useTriage';

/** Серия скрытий: один тост «Скрыто» с «Отменить» на всех, вернуть можно все разом. */
export function useHideMany(
  setHiddenRows: Dispatch<SetStateAction<readonly HiddenRow[]>>,
  unhide: (id: string) => Promise<void>,
): HideMany {
  const toast = useToast();
  const undo = useCallback(
    (ids: readonly string[]) => {
      Promise.allSettled(ids.map((id) => unhide(id))).then((results) => {
        const failed = results.filter((result) => result.status === 'rejected').length;
        if (failed > 0) toast.show({ text: `Не удалось вернуть вакансий: ${failed}` });
      });
    },
    [toast, unhide],
  );
  return useCallback<HideMany>(
    async (entries) => {
      const { done, failed } = await hideInBatches(entries);
      if (done.length === 0) return failed;
      const at = new Date().toISOString();
      const added = done.map(({ item, reason }): HiddenRow => ({ ...item, hidden: { reasonId: reason, at } }));
      const ids = done.map(({ item }) => item.cluster.id);
      setHiddenRows((rows) => [...added, ...rows.filter((row) => !ids.includes(row.cluster.id))]);
      toast.show({ text: 'Скрыто', undo: { label: 'Отменить', onUndo: () => undo(ids) } });
      return failed;
    },
    [toast, undo, setHiddenRows],
  );
}
