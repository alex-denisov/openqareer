import { useEffect, useMemo, useState } from 'react';
import type { CareerPushView, CareerRoleModel, SearchConditionsDraft } from './careerScreenTypes';
import {
  addCompanyToStopList,
  applyConditionsEdit,
  decisionProfileToSearchConditions,
  rejectRoleHypothesis,
  searchConditionsToDecisionProfile,
} from './careerConditionsStorage';
import type { EditableConditionField } from './CareerConditionsComponents';
import type { CareerScreenProps } from './CareerScreen';
import { useRoleHypotheses } from './useRoleHypotheses';
import { mapProposedRolesToCareerRoles } from './roleHypothesisAdapter';
import { getDecisionProfile, putDecisionProfile } from '../coach/coachApi';
import { loadDecisionProfile, saveDecisionProfile } from '../../../shared/workPreferences';

function useConditionsSync(
  initialConditions: SearchConditionsDraft | undefined,
  setConditions: React.Dispatch<React.SetStateAction<SearchConditionsDraft>>,
) {
  useEffect(() => {
    if (initialConditions) return;
    const controller = new AbortController();
    let active = true;
    getDecisionProfile(controller.signal)
      .then((profile) => {
        if (active && profile) {
          setConditions((prev) => decisionProfileToSearchConditions(profile, prev.stopList));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialConditions, setConditions]);
}

async function saveDecisionProfilePatch(
  updated: SearchConditionsDraft,
  onSaveConditions?: (conditions: SearchConditionsDraft) => Promise<void>,
) {
  const patch = searchConditionsToDecisionProfile(updated);
  saveDecisionProfile(patch);
  await putDecisionProfile(patch);
  if (onSaveConditions) await onSaveConditions(updated);
}

function useCareerConditionsState(
  initialConditions?: SearchConditionsDraft,
  onSaveConditions?: (conditions: SearchConditionsDraft) => Promise<void>,
) {
  const [conditions, setConditions] = useState<SearchConditionsDraft>(
    () => initialConditions ?? decisionProfileToSearchConditions(loadDecisionProfile()),
  );
  const [editingField, setEditingField] = useState<EditableConditionField>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useConditionsSync(initialConditions, setConditions);

  const savePatch = async (updated: SearchConditionsDraft) => {
    setSaveError(null);
    try {
      await saveDecisionProfilePatch(updated, onSaveConditions);
      setConditions(updated);
      setEditingField(null);
    } catch {
      setSaveError('Не сохранилось: нет связи с сервером. Значение осталось в поле.');
    }
  };

  return {
    conditions,
    setConditions,
    editingField,
    setEditingField,
    saveError,
    setSaveError,
    handleSaveSalary: (sal: number, noWage: boolean) =>
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
    handleAddStopCompany: (name: string) =>
      savePatch(
        applyConditionsEdit(conditions, {
          stopList: addCompanyToStopList(conditions.stopList, name),
        }),
      ),
  };
}

function useCareerRolesState(
  initialRoles?: readonly CareerRoleModel[],
  propLoading?: boolean,
  propMarketError?: string | null,
) {
  const roleHypo = useRoleHypotheses(
    initialRoles ? { roles: [], loading: false, failed: false } : undefined,
  );
  const loadedRoles = useMemo(
    () => mapProposedRolesToCareerRoles(roleHypo.roles),
    [roleHypo.roles],
  );
  const roles: readonly CareerRoleModel[] = initialRoles ?? loadedRoles;
  const [rejectedIds, setRejectedIds] = useState<ReadonlySet<string>>(new Set());
  const [showAllRoles, setShowAllRoles] = useState(false);

  return {
    activeRoles: roles.filter((r) => !rejectedIds.has(r.id)),
    showAllRoles,
    setShowAllRoles,
    handleRejectRole: (roleId: string) =>
      setRejectedIds((prev) => rejectRoleHypothesis(prev, roleId)),
    isLoading: propLoading ?? (initialRoles ? false : roleHypo.loading),
    marketError:
      propMarketError ??
      (initialRoles ? null : roleHypo.failed ? 'Не удалось загрузить гипотезы с сервера.' : null),
  };
}

export function useCareerScreenState(props: CareerScreenProps) {
  const rolesState = useCareerRolesState(props.initialRoles, props.isLoading, props.marketError);
  const condState = useCareerConditionsState(props.initialConditions, props.onSaveConditions);
  const [pushView, setPushView] = useState<CareerPushView>(props.initialPushView ?? 'home');

  const handleRejectRole = (roleId: string) => {
    rolesState.handleRejectRole(roleId);
    if (pushView === roleId) setPushView('home');
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
