import { useEffect, useMemo, useState } from 'react';
import type {
  CareerPushView,
  CareerRoleModel,
  RolesMarketSummary,
  SearchConditionsDraft,
  StopCompany,
} from './careerScreenTypes';
import {
  applyConditionsEdit,
  decisionProfileToSearchConditions,
  EMPTY_SEARCH_CONDITIONS,
  searchConditionsToDecisionProfile,
} from './careerConditionsStorage';
import type { EditableConditionField } from './CareerConditionsComponents';
import type { CareerScreenProps } from './CareerScreen';
import { mapProposedRolesToCareerRoles, summarizeRolesMarket } from './roleHypothesisAdapter';
import { rejectRole, useCareerRoles } from './careerRoleStore';
import { getDecisionProfile, putDecisionProfile } from '../coach/coachApi';
import { addCandidateStopCompany, listCandidateStopCompanies } from '../automation/automationApi';
import type { CandidateDecisionProfile } from '../../../shared/workPreferences';

const STOP_ORIGIN_LABELS: Readonly<Record<string, string>> = {
  manual: 'добавлено вручную',
  import: 'из импорта',
};

function toStopCompanies(
  rows: readonly { company: string; origin: string }[],
): readonly StopCompany[] {
  return rows.map((row) => ({
    id: row.company,
    name: row.company,
    origin: STOP_ORIGIN_LABELS[row.origin] ?? row.origin,
  }));
}

const SAVE_ERROR = 'Не сохранилось: нет связи с сервером. Значение осталось в поле.';

function useConditionsLoad(
  initialConditions: SearchConditionsDraft | undefined,
  setConditions: React.Dispatch<React.SetStateAction<SearchConditionsDraft>>,
  setProfile: (profile: CandidateDecisionProfile | null) => void,
) {
  useEffect(() => {
    if (initialConditions) return;
    const controller = new AbortController();
    let active = true;
    Promise.allSettled([getDecisionProfile(controller.signal), listCandidateStopCompanies()]).then(
      ([profileRead, stopRead]) => {
        if (!active) return;
        const profile = profileRead.status === 'fulfilled' ? profileRead.value : null;
        const stopList = stopRead.status === 'fulfilled' ? toStopCompanies(stopRead.value) : [];
        setProfile(profile);
        setConditions(decisionProfileToSearchConditions(profile, stopList));
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialConditions, setConditions, setProfile]);
}

function useStopListAdd(
  conditions: SearchConditionsDraft,
  setConditions: (next: SearchConditionsDraft) => void,
  setSaveError: (message: string | null) => void,
  onSaveConditions?: (conditions: SearchConditionsDraft) => Promise<void>,
) {
  return async (name: string): Promise<boolean> => {
    setSaveError(null);
    try {
      if (onSaveConditions) {
        const stopList = [...conditions.stopList, { id: name, name, origin: 'добавлено вручную' }];
        const updated = applyConditionsEdit(conditions, { stopList });
        await onSaveConditions(updated);
        setConditions(updated);
        return true;
      }
      await addCandidateStopCompany(name);
      const stopList = toStopCompanies(await listCandidateStopCompanies());
      setConditions(applyConditionsEdit(conditions, { stopList }));
      return true;
    } catch {
      setSaveError(SAVE_ERROR);
      return false;
    }
  };
}

function fieldSaveHandlers(
  conditions: SearchConditionsDraft,
  savePatch: (updated: SearchConditionsDraft) => Promise<boolean>,
) {
  return {
    handleSaveSalary: (sal: number | null, noWage: boolean) =>
      savePatch(
        applyConditionsEdit(conditions, {
          salaryFrom: { amountRubles: sal, showWithoutSalary: noWage },
        }),
      ),
    handleSaveFormat: (fmt: SearchConditionsDraft['format']) =>
      savePatch(applyConditionsEdit(conditions, { format: fmt })),
    handleSaveGeo: (geo: readonly string[]) =>
      savePatch(
        applyConditionsEdit(conditions, {
          geography: { ...conditions.geography, selected: geo },
        }),
      ),
  };
}

function useCareerConditionsState(
  initialConditions?: SearchConditionsDraft,
  onSaveConditions?: (conditions: SearchConditionsDraft) => Promise<void>,
) {
  const [conditions, setConditions] = useState<SearchConditionsDraft>(
    () => initialConditions ?? EMPTY_SEARCH_CONDITIONS,
  );
  const [profile, setProfile] = useState<CandidateDecisionProfile | null>(null);
  const [editingField, setEditingField] = useState<EditableConditionField>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useConditionsLoad(initialConditions, setConditions, setProfile);

  const savePatch = async (updated: SearchConditionsDraft): Promise<boolean> => {
    setSaveError(null);
    try {
      if (onSaveConditions) await onSaveConditions(updated);
      else {
        const next = searchConditionsToDecisionProfile(updated, profile);
        await putDecisionProfile(next);
        setProfile(next);
      }
      setConditions(updated);
      setEditingField(null);
      return true;
    } catch {
      setSaveError(SAVE_ERROR);
      return false;
    }
  };

  const handleAddStopCompany = useStopListAdd(
    conditions,
    setConditions,
    setSaveError,
    onSaveConditions,
  );

  return {
    conditions,
    editingField,
    setEditingField,
    saveError,
    setSaveError,
    ...fieldSaveHandlers(conditions, savePatch),
    handleAddStopCompany,
  };
}

function useCareerRolesState(props: CareerScreenProps) {
  const provided = props.initialRoles;
  const store = useCareerRoles(!provided);
  const loadedRoles = useMemo(
    () =>
      mapProposedRolesToCareerRoles(store.roles, {
        acceptedTitle: store.acceptedTitle,
        offersDismissed: store.offersDismissed,
      }).filter((role) => !store.rejected.includes(role.id)),
    [store.roles, store.acceptedTitle, store.offersDismissed, store.rejected],
  );
  const [localRejected, setLocalRejected] = useState<readonly string[]>([]);
  const roles: readonly CareerRoleModel[] = provided
    ? provided.filter((role) => !localRejected.includes(role.id))
    : loadedRoles;
  const storeLoading = store.status === 'idle' || store.status === 'loading';

  return {
    activeRoles: roles,
    summary: summarizeRolesMarket(roles) as RolesMarketSummary,
    actionError: provided ? null : store.actionError,
    handleRejectRole: async (roleId: string): Promise<boolean> => {
      if (provided) {
        setLocalRejected((prev) => [...prev, roleId]);
        return true;
      }
      return rejectRole(roleId);
    },
    isLoading: props.isLoading ?? (provided ? false : storeLoading && store.roles.length === 0),
    marketError:
      props.marketError ??
      (provided || store.status !== 'failed' ? null : 'Не удалось загрузить роли с сервера.'),
  };
}

export function useCareerScreenState(props: CareerScreenProps) {
  const rolesState = useCareerRolesState(props);
  const condState = useCareerConditionsState(props.initialConditions, props.onSaveConditions);
  const [pushView, setPushView] = useState<CareerPushView>(props.initialPushView ?? 'home');

  const handleRejectRole = async (roleId: string): Promise<void> => {
    const ok = await rolesState.handleRejectRole(roleId);
    if (ok && pushView === `role:${roleId}`) setPushView('home');
  };

  return {
    ...condState,
    ...rolesState,
    pushView,
    setPushView,
    handleRejectRole,
    isMobile: props.isMobile ?? false,
  };
}

export type CareerScreenState = ReturnType<typeof useCareerScreenState>;
