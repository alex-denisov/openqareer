import { useState } from 'react';
import { DEFAULT_MOCK_ROLES, DEFAULT_SEARCH_CONDITIONS } from './careerMockData';
import type { CareerPushView, SearchConditionsDraft } from './careerScreenTypes';
import { applyConditionsEdit, rejectRoleHypothesis } from './careerConditionsStorage';
import type { EditableConditionField } from './CareerConditionsComponents';
import type { CareerScreenProps } from './CareerScreen';

export function useCareerScreenState({
  initialRoles = DEFAULT_MOCK_ROLES,
  initialConditions = DEFAULT_SEARCH_CONDITIONS,
  onSaveConditions,
  isMobile = false,
  initialPushView = 'home',
}: CareerScreenProps) {
  const [conditions, setConditions] = useState<SearchConditionsDraft>(initialConditions);
  const [rejectedIds, setRejectedIds] = useState<ReadonlySet<string>>(new Set());
  const [showAllRoles, setShowAllRoles] = useState(false);
  const [editingField, setEditingField] = useState<EditableConditionField>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pushView, setPushView] = useState<CareerPushView>(initialPushView);

  const activeRoles = initialRoles.filter((r) => !rejectedIds.has(r.id));

  const handleRejectRole = (roleId: string) => {
    setRejectedIds((prev) => rejectRoleHypothesis(prev, roleId));
    if (pushView === roleId) setPushView('home');
  };

  const handleSaveSalary = async (salary: number, showNoWage: boolean) => {
    setSaveError(null);
    const updated = applyConditionsEdit(conditions, {
      salaryFrom: { amountRubles: salary, showWithoutSalary: showNoWage },
    });
    try {
      if (onSaveConditions) await onSaveConditions(updated);
      setConditions(updated);
      setEditingField(null);
    } catch {
      setSaveError('Не сохранилось: нет связи с сервером. Значение осталось в поле.');
    }
  };

  return {
    conditions,
    setConditions,
    activeRoles,
    showAllRoles,
    setShowAllRoles,
    editingField,
    setEditingField,
    saveError,
    setSaveError,
    pushView,
    setPushView,
    handleRejectRole,
    handleSaveSalary,
    isMobile,
  };
}
