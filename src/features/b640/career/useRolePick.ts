import { useEffect, useRef, useState } from 'react';
import type { CampaignMetaView } from '../../coach/matchedVacancyApi';
import { buildNodePath } from '../routes';
import { useShell } from '../shell/ShellContext';
import { saveSearchRoles } from './careerApi';
import type { RoleRow } from './rolesModel';

export type PickState = 'idle' | 'busy' | 'error';

export interface RolePick {
  readonly picked: ReadonlySet<string>;
  readonly selected: readonly string[];
  readonly state: PickState;
  readonly toggle: (title: string) => void;
  /** Сохранить отмеченные роли поиска и перейти к вакансиям. */
  readonly search: () => Promise<void>;
}

export const roleKey = (title: string): string => title.trim().toLocaleLowerCase('ru');

/** Название главной кнопки: одна роль — по имени, несколько — числом. */
export function searchButtonLabel(selected: readonly string[]): string {
  if (selected.length === 1) return `Искать в роли ${selected[0]}`;
  return selected.length > 1 ? `Искать в ${selected.length} ролях` : 'Искать';
}

/** Отметки ролей поиска (S9c, S10): одна запись кампании, затем «Вакансии». */
export function useRolePick(
  rows: readonly RoleRow[],
  initial: readonly string[],
  campaign: CampaignMetaView,
): RolePick {
  const { navigate } = useShell();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(initial.map(roleKey)));
  const [state, setState] = useState<PickState>('idle');
  const selected = rows.filter((row) => picked.has(roleKey(row.title))).map((row) => row.title);

  // Роль поиска появилась после перечтения («Назвать свою роль»): она отмечена, не потеряна.
  const seen = useRef(new Set(initial.map(roleKey)));
  const initialKey = initial.map(roleKey).join('\n');
  useEffect(() => {
    const fresh = initialKey.split('\n').filter((title) => title && !seen.current.has(title));
    if (fresh.length === 0) return;
    fresh.forEach((title) => seen.current.add(title));
    setPicked((current) => new Set([...current, ...fresh]));
  }, [initialKey]);

  const toggle = (title: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(roleKey(title))) next.delete(roleKey(title));
      else next.add(roleKey(title));
      return next;
    });

  const search = async () => {
    setState('busy');
    try {
      // Роли кампании, которых нет среди строк выбора, остаются как были.
      const shown = new Set(rows.map((row) => roleKey(row.title)));
      const kept = campaign.roles.value.filter((title) => !shown.has(roleKey(title)));
      await saveSearchRoles([...selected, ...kept], campaign);
      navigate(buildNodePath('s07'));
    } catch {
      setState('error');
    }
  };

  return { picked, selected, state, toggle, search };
}
