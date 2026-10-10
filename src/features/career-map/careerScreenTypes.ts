export type RoleStatus = 'hypothesis' | 'skills_checked' | 'open_for_search';

export interface MissingRoleRequirement {
  readonly text: string;
  readonly isWarning?: boolean;
  readonly isQuestion?: boolean;
  readonly linkSection?: string;
  readonly linkText?: string;
}

export type RoleActionKind =
  'fill_with_consultant' | 'open_vacancies' | 'check_skills' | 'few_data';

export interface RoleNextAction {
  readonly label: string;
  readonly action: RoleActionKind;
  readonly href?: string;
}

export interface CareerRoleModel {
  readonly id: string;
  readonly title: string;
  readonly status: RoleStatus;
  readonly wageDisplay: string;
  readonly isWageCalculated: boolean;
  readonly vacancyCount: number;
  readonly observedDate: string;
  readonly sampleNote: string;
  readonly confirmedItems: readonly string[];
  readonly missingItems: readonly MissingRoleRequirement[];
  readonly skillCheckBenefit?: string;
  readonly nextAction: RoleNextAction;
  readonly hypothesisReason?: string;
  readonly rejected?: boolean;
}

export interface StopCompany {
  readonly id: string;
  readonly name: string;
  readonly origin: string;
}

export interface SearchConditionsDraft {
  readonly geography: {
    readonly selected: readonly string[];
    readonly isRelocationEnabled: boolean;
  };
  readonly salaryFrom: {
    readonly amountRubles: number;
    readonly showWithoutSalary: boolean;
  };
  readonly format: {
    readonly office: boolean;
    readonly hybrid: boolean;
    readonly remote: boolean;
  };
  readonly stopList: readonly StopCompany[];
  readonly matchingStats: {
    readonly matched: number;
    readonly total: number;
    readonly asOf: string;
  };
}

export type CareerPushView =
  'home' | 'dir' | 'head' | 'cto' | 'vp' | 'geo' | 'sal' | 'fmt' | 'stop';
