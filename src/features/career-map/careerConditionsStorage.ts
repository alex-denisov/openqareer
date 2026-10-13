import type { SearchConditionsDraft, StopCompany } from './careerScreenTypes';
import type {
  CandidateDecisionProfile,
  DecisionWorkFormatId,
} from '../../../shared/workPreferences';

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

export function decisionProfileToSearchConditions(
  profile: Partial<CandidateDecisionProfile>,
  stopList: readonly StopCompany[] = [],
): SearchConditionsDraft {
  const formats = profile.workFormats ?? [];
  const selectedGeo =
    profile.citizenship && profile.citizenship.length > 0
      ? profile.citizenship
      : ['Москва', 'Удалённо из РФ'];

  const draft: SearchConditionsDraft = {
    geography: {
      selected: selectedGeo,
      isRelocationEnabled: formats.includes('relocation'),
    },
    salaryFrom: {
      amountRubles: profile.salaryFloor ?? 450000,
      showWithoutSalary: true,
    },
    format: {
      office: formats.includes('office'),
      hybrid: formats.includes('home_market') || formats.length === 0,
      remote:
        formats.includes('remote_home') ||
        formats.includes('remote_abroad') ||
        formats.length === 0,
    },
    stopList,
    matchingStats: {
      matched: 148,
      total: 214,
      asOf: '07.10 09:12',
    },
  };

  return {
    ...draft,
    matchingStats: recalculateMatchingStats(draft),
  };
}

export function searchConditionsToDecisionProfile(
  conditions: SearchConditionsDraft,
  existing?: Partial<CandidateDecisionProfile>,
): CandidateDecisionProfile {
  const formats: DecisionWorkFormatId[] = [];
  if (conditions.format.remote) formats.push('remote_home');
  if (conditions.format.hybrid) formats.push('home_market');
  if (conditions.format.office) formats.push('office');
  if (conditions.geography.isRelocationEnabled) formats.push('relocation');

  return {
    citizenship: conditions.geography.selected,
    taxStatus: existing?.taxStatus ?? '',
    languages: existing?.languages ?? [],
    workFormats: formats,
    salaryFloor: conditions.salaryFrom.amountRubles,
    salaryCurrency: existing?.salaryCurrency ?? 'RUB',
    cushionMonths: existing?.cushionMonths,
    hasFamily: existing?.hasFamily ?? false,
    updatedAt: new Date().toISOString(),
  };
}

export class CareerConditionsStorage {
  private committed: SearchConditionsDraft;
  private draft: SearchConditionsDraft;
  private simulateFailure = false;

  constructor(initial?: SearchConditionsDraft) {
    const fallback = initial ?? decisionProfileToSearchConditions({});
    this.committed = fallback;
    this.draft = fallback;
  }

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
