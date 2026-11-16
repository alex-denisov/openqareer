import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { listCandidateCompanyWants } from '../../../vacancies/candidateCompaniesApi';
import {
  companyLookupKey,
  toggleCompanyWantByName,
  wantedCompanyRecords,
} from '../../../vacancies/vacancyScreenCollections';
import { useShell } from '../../shell/ShellContext';
import { useToast } from '../../kit';
import { buildNodePath } from '../../routes';
import { hideVacancy, unhideVacancy } from '../skipApi';
import type { VacancyLinks } from '../vacancyLinks';
import type { MenuView, RowMenuActions } from './RowMenu';
import type { TableMenu } from './VacancyTable';

export interface RowInteractions {
  readonly openId: string | null;
  readonly menu: TableMenu | null;
  readonly hiddenIds: ReadonlySet<string>;
  readonly wantedKeys: ReadonlySet<string>;
  readonly toggleOpen: (id: string) => void;
  readonly openMenu: (id: string, view: MenuView) => void;
  readonly closeMenu: () => void;
  readonly toggleSaved: (item: MatchedVacancyItem) => void;
  readonly actionsFor: (item: MatchedVacancyItem) => RowMenuActions;
}

function errorText(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/** Компании, отмеченные «Хочу»; сбой чтения — меток нет, строка работает как раньше. */
function useWantRecords() {
  const [records, setRecords] = useState(() => wantedCompanyRecords([]));
  useEffect(() => {
    let alive = true;
    listCandidateCompanyWants()
      .then((wants) => {
        if (alive) setRecords(wantedCompanyRecords(wants));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return records;
}

interface ActionDeps {
  readonly links: VacancyLinks;
  readonly records: ReturnType<typeof wantedCompanyRecords>;
  readonly wantedKeys: ReadonlySet<string>;
  readonly closeMenu: () => void;
  readonly toGoal: () => void;
  readonly onHidden: (id: string) => void;
}

function buildActions(item: MatchedVacancyItem, deps: ActionDeps): RowMenuActions {
  const { cluster } = item;
  const company = cluster.canonicalCompany ?? '';
  return {
    want: async () => {
      if (!deps.wantedKeys.has(companyLookupKey(company))) {
        await toggleCompanyWantByName(company, deps.records);
      }
      deps.closeMenu();
      deps.toGoal();
    },
    hide: async (reason) => {
      await hideVacancy(cluster.id, reason);
      deps.closeMenu();
      deps.onHidden(cluster.id);
    },
    applied: async (occurredAt) => {
      await deps.links.markApplied(cluster, occurredAt);
      deps.closeMenu();
    },
  };
}

/** Раскрытая строка, окно действий, скрытие с отменой, «Хочу», «Уже откликнулись», ☆. */
export function useRowInteractions(links: VacancyLinks): RowInteractions {
  const { navigate } = useShell();
  const toast = useToast();
  const records = useWantRecords();
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<TableMenu | null>(null);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const wantedKeys = useMemo(() => new Set(records.keys()), [records]);

  const toggleOpen = useCallback((id: string) => setOpenId((current) => (current === id ? null : id)), []);
  const openMenu = useCallback((id: string, view: MenuView) => setMenu({ id, view }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const toggleSaved = useCallback(
    (item: MatchedVacancyItem) => {
      links.toggleSaved(item.cluster).catch((reason: unknown) =>
        toast.show({ text: errorText(reason, 'Не удалось изменить сохранённые. Попробуйте ещё раз.') }),
      );
    },
    [links, toast],
  );

  const undoHide = useCallback(
    (id: string) => {
      unhideVacancy(id)
        .then(() => setHiddenIds((ids) => new Set([...ids].filter((value) => value !== id))))
        .catch((reason: unknown) => toast.show({ text: errorText(reason, 'Не удалось вернуть вакансию') }));
    },
    [toast],
  );

  const actionsFor = useCallback(
    (item: MatchedVacancyItem): RowMenuActions =>
      buildActions(item, {
        links,
        records,
        wantedKeys,
        closeMenu,
        toGoal: () => navigate(buildNodePath('o08')),
        onHidden: (id) => {
          setHiddenIds((ids) => new Set([...ids, id]));
          toast.show({ text: 'Скрыто', undo: { label: 'Отменить', onUndo: () => undoHide(id) } });
        },
      }),
    [links, navigate, records, toast, undoHide, wantedKeys, closeMenu],
  );

  return { openId, menu, hiddenIds, wantedKeys, toggleOpen, openMenu, closeMenu, toggleSaved, actionsFor };
}
