import type { SearchConditionsDraft, StopCompany } from './careerScreenTypes';
import type {
  CandidateDecisionProfile,
  DecisionWorkFormatId,
} from '../../../shared/workPreferences';

export const EMPTY_SEARCH_CONDITIONS: SearchConditionsDraft = {
  geography: { selected: [], isRelocationEnabled: false },
  salaryFrom: { amountRubles: null, showWithoutSalary: true },
  format: { office: false, hybrid: false, remote: false },
  stopList: [],
};

export function applyConditionsEdit(
  current: SearchConditionsDraft,
  patch: Partial<SearchConditionsDraft>,
): SearchConditionsDraft {
  return { ...current, ...patch };
}

/**
 * Профиль ограничений → условия экрана. Чего кандидат не указал, то и не
 * показывается: гражданство не география, а пустой пол зарплаты не 450 000 ₽.
 */
export function decisionProfileToSearchConditions(
  profile: Partial<CandidateDecisionProfile> | null,
  stopList: readonly StopCompany[] = [],
): SearchConditionsDraft {
  const formats = profile?.workFormats ?? [];
  return {
    geography: {
      selected: profile?.searchLocations ?? [],
      isRelocationEnabled: formats.includes('relocation'),
    },
    salaryFrom: {
      amountRubles: profile?.salaryFloor ?? null,
      showWithoutSalary: true,
    },
    format: {
      office: formats.includes('office'),
      hybrid: formats.includes('home_market'),
      remote: formats.includes('remote_home') || formats.includes('remote_abroad'),
    },
    stopList,
  };
}

export function searchConditionsToDecisionProfile(
  conditions: SearchConditionsDraft,
  existing?: Partial<CandidateDecisionProfile> | null,
): CandidateDecisionProfile {
  const kept = (existing?.workFormats ?? []).filter((id) => id === 'remote_abroad');
  const formats: DecisionWorkFormatId[] = [...kept];
  if (conditions.format.remote && !kept.includes('remote_abroad')) formats.push('remote_home');
  if (conditions.format.hybrid) formats.push('home_market');
  if (conditions.format.office) formats.push('office');
  if (conditions.geography.isRelocationEnabled) formats.push('relocation');

  return {
    citizenship: existing?.citizenship ?? [],
    searchLocations: conditions.geography.selected,
    taxStatus: existing?.taxStatus ?? '',
    languages: existing?.languages ?? [],
    workFormats: formats,
    ...(conditions.salaryFrom.amountRubles !== null
      ? { salaryFloor: conditions.salaryFrom.amountRubles }
      : {}),
    salaryCurrency: existing?.salaryCurrency ?? 'RUB',
    cushionMonths: existing?.cushionMonths,
    hasFamily: existing?.hasFamily ?? false,
  };
}

export function formatConditionsFormat(format: SearchConditionsDraft['format']): string | null {
  const parts = [
    format.office ? 'Офис' : null,
    format.hybrid ? 'Гибрид' : null,
    format.remote ? 'удалённо' : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatSalaryFloor(amount: number | null): string | null {
  return amount === null ? null : `${amount.toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₽`;
}

export function formatCompaniesCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} компания`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} компании`;
  return `${count} компаний`;
}
