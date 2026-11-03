import { useCallback, useState } from 'react';
import {
  executeApplicationBulk,
  previewApplicationBulk,
  type ApplicationBulkAction,
  type ApplicationListQuery,
} from './applicationsApi';
import { bulkResultNotice, emptyBulkNotice } from './applicationSelectionModel';

export interface ApplicationBulkTarget {
  readonly query: ApplicationListQuery;
  /** Rows picked by hand; undefined means every row of the filter. */
  readonly ids?: readonly string[];
}

export interface BulkRequest {
  readonly action: ApplicationBulkAction;
  readonly labelName?: string;
  /** Runs after a confirmed action, e.g. «Исправить резюме и повторить» opens the resume. */
  readonly after?: () => void;
}

interface PendingBulk extends BulkRequest {
  readonly count: number;
}

export interface ApplicationBulkRunner {
  readonly pending: PendingBulk | null;
  readonly busy: boolean;
  readonly error: string;
  readonly preview: (request: BulkRequest) => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

export function useApplicationBulkRunner(
  target: ApplicationBulkTarget,
  onComplete: (notice: string) => void,
): ApplicationBulkRunner {
  const [pending, setPending] = useState<PendingBulk | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { query, ids } = target;
  const run = useCallback(async (task: () => Promise<void>, failure: string) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch {
      setError(failure);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }, []);
  const preview = useCallback(
    (request: BulkRequest) =>
      void run(async () => {
        const result = await previewApplicationBulk(query, request.action, ids);
        if (result.affectedCount > 0) setPending({ ...request, count: result.affectedCount });
        else {
          setPending(null);
          setError(emptyBulkNotice(request.action));
        }
      }, 'Не удалось проверить состав массового действия. Повторите запрос.'),
    [ids, query, run],
  );
  const confirm = useCallback(() => {
    if (!pending) return;
    void run(async () => {
      const result = await executeApplicationBulk(query, pending.action, pending.count, ids);
      setPending(null);
      onComplete(bulkResultNotice(pending.action, result, pending.labelName));
      pending.after?.();
    }, 'Список изменился или действие не выполнено. Обновите фильтр и проверьте ещё раз.');
  }, [ids, onComplete, pending, query, run]);
  const cancel = useCallback(() => setPending(null), []);
  return { pending, busy, error, preview, confirm, cancel };
}
