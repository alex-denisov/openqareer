import { useCallback, useState } from 'react';
import { useHiddenVacancies, type HiddenVacancies } from './useHiddenVacancies';
import type { RowInteractions } from './useRowInteractions';

export interface HiddenSection {
  readonly show: boolean;
  readonly setShow: (show: boolean) => void;
  readonly hidden: HiddenVacancies;
  readonly menuId: string | null;
  readonly setMenuId: (id: string | null) => void;
  readonly unhide: (id: string) => Promise<void>;
}

/** «Показать скрытые»: чип, порции с сервера и возврат строки в подборку с перечитыванием подборки. */
export function useHiddenSection(rows: RowInteractions, refresh: (() => void) | undefined): HiddenSection {
  const [show, setShow] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const hidden = useHiddenVacancies(show, rows.hiddenRows);
  const { remove } = hidden;
  const { unhide: unhideRow } = rows;
  const unhide = useCallback(
    async (id: string) => {
      await unhideRow(id);
      remove(id);
      setMenuId(null);
      refresh?.();
    },
    [unhideRow, remove, refresh],
  );
  return { show, setShow, hidden, menuId, setMenuId, unhide };
}
