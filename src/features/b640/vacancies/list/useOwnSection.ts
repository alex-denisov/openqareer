import { useCallback, useState } from 'react';
import { useToast } from '../../kit';
import { useShell } from '../../shell/ShellContext';
import { ownPanelRequested } from './ownPanelLink';
import { useOwnVacancies, type OwnVacancies } from './useOwnVacancies';

/** Свои вакансии и панель «Своя вакансия» на экране подборки (B676). */
export interface OwnSection extends OwnVacancies {
  readonly panelOpen: boolean;
  readonly togglePanel: () => void;
  readonly closePanel: () => void;
  readonly removeWithToast: (id: string) => void;
}

export function useOwnSection(): OwnSection {
  const own = useOwnVacancies();
  const toast = useToast();
  const { search } = useShell();
  const [panelOpen, setPanelOpen] = useState(() => ownPanelRequested(search));
  const { resetStatus, remove } = own;
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    resetStatus();
  }, [resetStatus]);
  const togglePanel = useCallback(() => {
    if (panelOpen) closePanel();
    else setPanelOpen(true);
  }, [panelOpen, closePanel]);
  const removeWithToast = useCallback((id: string) => {
    remove(id).then(
      () => toast.show({ text: 'Удалено' }),
      () => toast.show({ text: 'Не удалось удалить. Попробуйте ещё раз.' }),
    );
  }, [remove, toast]);
  return { ...own, panelOpen, togglePanel, closePanel, removeWithToast };
}
