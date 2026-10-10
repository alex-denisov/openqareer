import type { SearchConditionsDraft, StopCompany } from './careerScreenTypes';
import { DEFAULT_SEARCH_CONDITIONS } from './careerMockData';

export function recalculateMatchingStats(conditions: SearchConditionsDraft): {
  matched: number;
  total: number;
  asOf: string;
} {
  let matched = 214;
  const salary = conditions.salaryFrom.amountRubles;
  if (salary > 450000) {
    matched = Math.max(20, Math.round(matched * (450000 / salary)));
  } else {
    matched = 148;
  }

  if (!conditions.salaryFrom.showWithoutSalary) {
    matched = Math.round(matched * 0.7);
  }

  if (conditions.format.office && !conditions.format.remote) {
    matched = Math.round(matched * 0.4);
  }

  const stopCount = conditions.stopList.length;
  matched = Math.max(5, matched - stopCount * 4);

  return {
    matched,
    total: 214,
    asOf: '07.10 09:12',
  };
}

export function rejectRoleHypothesis(current: ReadonlySet<string>, roleId: string): Set<string> {
  const next = new Set(current);
  next.add(roleId);
  return next;
}

export function restoreRejectedRole(current: ReadonlySet<string>, roleId: string): Set<string> {
  const next = new Set(current);
  next.delete(roleId);
  return next;
}

export function addCompanyToStopList(
  current: readonly StopCompany[],
  companyName: string,
): readonly StopCompany[] {
  const trimmed = companyName.trim();
  if (!trimmed) return current;
  const id = `stop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return [
    ...current,
    {
      id,
      name: trimmed,
      origin: 'добавлено вручную',
    },
  ];
}

export function applyConditionsEdit(
  current: SearchConditionsDraft,
  patch: Partial<SearchConditionsDraft>,
): SearchConditionsDraft {
  const updated: SearchConditionsDraft = {
    ...current,
    ...patch,
  };
  return {
    ...updated,
    matchingStats: recalculateMatchingStats(updated),
  };
}

export class CareerConditionsStorage {
  private committed: SearchConditionsDraft = DEFAULT_SEARCH_CONDITIONS;
  private draft: SearchConditionsDraft = DEFAULT_SEARCH_CONDITIONS;
  private simulateFailure = false;

  public getConditions(): SearchConditionsDraft {
    return this.committed;
  }

  public getDraftConditions(): SearchConditionsDraft {
    return this.draft;
  }

  public setDraftConditions(draft: SearchConditionsDraft): void {
    this.draft = draft;
  }

  public rollbackDraft(): void {
    this.draft = this.committed;
  }

  public simulateNetworkFailure(shouldFail: boolean): void {
    this.simulateFailure = shouldFail;
  }

  public async saveConditions(
    newConditions: SearchConditionsDraft,
  ): Promise<SearchConditionsDraft> {
    this.draft = newConditions;

    if (this.simulateFailure) {
      throw new Error('Не сохранилось: нет связи с сервером. Значение осталось в поле.');
    }

    const calculated = applyConditionsEdit(newConditions, {});
    this.committed = calculated;
    this.draft = calculated;
    return this.committed;
  }
}
