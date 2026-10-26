/** Что подтверждено у роли: совпадение с навыками профиля или итог проверки навыков (B565). */
export interface ConfirmedRoleItem {
  readonly text: string;
  readonly source: 'profile' | 'check';
}

export type RoleStatus = 'hypothesis' | 'skills_checked' | 'open_for_search';

export interface MissingRoleRequirement {
  readonly text: string;
  readonly isWarning?: boolean;
  /** Раздел профиля, где этот пробел закрывается: «Профиль, Навыки». */
  readonly linkSection?: string;
}

export type RoleActionKind =
  'fill_with_consultant' | 'open_vacancies' | 'check_skills' | 'few_data';

export interface RoleNextAction {
  /** Подпись строки-действия в списке ролей на 390. */
  readonly label: string;
  readonly action: RoleActionKind;
}

export interface CareerRoleModel {
  readonly id: string;
  readonly title: string;
  readonly status: RoleStatus;
  readonly wageDisplay: string;
  readonly isWageCalculated: boolean;
  /** «вилка по 94 вакансиям с зарплатой», когда с зарплатой не все вакансии роли. */
  readonly wageSampleNote: string | null;
  readonly vacancyCount: number;
  /** ДД.ММ последнего наблюдения роли в каталоге; `null` — вакансий не найдено. */
  readonly observedDate: string | null;
  /** Тот же момент в ISO — для сравнения дат в сводке. */
  readonly observedAt: string | null;
  /** Площадки, на которых найдены вакансии роли: «hh.ru», «LinkedIn». */
  readonly sources: readonly string[];
  readonly confirmedItems: readonly ConfirmedRoleItem[];
  readonly missingItems: readonly MissingRoleRequirement[];
  /** «Сверка с требованиями 88 вакансий, 05.10» или честное «не сверено». */
  readonly requirementsNote: string;
  readonly skillCheckBenefit?: string;
  readonly nextAction: RoleNextAction;
  readonly hypothesisReason?: string;
  /** Кандидат ответил «Не сейчас» на предложение открыть роль для поиска. */
  readonly offerDismissed: boolean;
  /**
   * Роль уже у кандидата: выбрана в мастере, принята или навыки по ней
   * проверены. Консультант её не предлагает (26.10).
   */
  readonly alreadyChosen?: boolean;
}

export interface StopCompany {
  readonly id: string;
  readonly name: string;
  readonly origin: string;
}

/**
 * Условия поиска кандидата. Пустое значение — «не указано», а не умолчание:
 * подставлять Москву или 450 000 ₽ значило бы искать за кандидата.
 */
export interface SearchConditionsDraft {
  readonly geography: {
    readonly selected: readonly string[];
    readonly isRelocationEnabled: boolean;
  };
  readonly salaryFrom: {
    readonly amountRubles: number | null;
    readonly showWithoutSalary: boolean;
  };
  readonly format: {
    readonly office: boolean;
    readonly hybrid: boolean;
    readonly remote: boolean;
  };
  readonly stopList: readonly StopCompany[];
}

/** Сводка рынка по ролям — из тех же данных, что и строки ролей. */
export interface RolesMarketSummary {
  readonly vacancyTotal: number;
  readonly asOf: string | null;
  readonly sources: readonly string[];
}

export type CareerPushView = 'home' | 'geo' | 'sal' | 'fmt' | 'stop' | `role:${string}`;
