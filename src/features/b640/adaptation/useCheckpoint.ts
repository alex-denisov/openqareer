import { useCallback, useEffect, useState } from 'react';

export type Checkpoint<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly value: T };

/** Загрузка свода по месту работы; `replace` кладёт ответ записи без повторного чтения. */
export function useCheckpoint<T>(workplaceId: string, load: (id: string) => Promise<T>) {
  const [data, setData] = useState<Checkpoint<T>>({ state: 'loading' });
  const reload = useCallback(() => {
    let live = true;
    setData({ state: 'loading' });
    load(workplaceId).then(
      (value) => live && setData({ state: 'ready', value }),
      () => live && setData({ state: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [workplaceId, load]);
  useEffect(reload, [reload]);
  const replace = useCallback((value: T) => setData({ state: 'ready', value }), []);
  return { data, reload: () => void reload(), replace };
}
