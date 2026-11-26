import { useEffect, useState } from 'react';
import type { ManualApplyItem } from '../../../../../shared/manualApply';
import { listManualQueue } from '../../apply/data/manualApplyApi';

export type ManualQueue = ReadonlyMap<string, ManualApplyItem>;

const EMPTY: ManualQueue = new Map();
const REFRESH_MS = 5000;

/**
 * Отклики «отправить вручную» по id отклика (B787). Очередь дополняет список: не прочиталась —
 * строки показываются без неё. Пока что-то готовится, состояние перечитывается.
 */
export function useManualQueue(): ManualQueue {
  const [queue, setQueue] = useState<ManualQueue>(EMPTY);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const read = () => {
      listManualQueue(controller.signal)
        .then((items) => {
          if (controller.signal.aborted) return;
          setQueue(new Map(items.map((item) => [item.applicationId, item])));
          const preparing = items.some((item) => item.preparing);
          if (preparing) timer = window.setTimeout(read, REFRESH_MS);
        })
        .catch(() => undefined);
    };
    read();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);
  return queue;
}
