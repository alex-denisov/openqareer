import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type { RelocationScenarioInput } from '../../../shared/relocationScenario';

type ScenarioCountry = RelocationScenarioInput['countryCode'];
type PayrollOptions = NonNullable<RelocationScenarioInput['payrollOptions']>;

export interface ScenarioFamily {
  readonly hasPartner: boolean;
  readonly children: number;
}

/** Cities the editor offers per country with a tax scale; the calculation itself is country-wide. */
export const RELOCATION_CITIES: Readonly<Record<ScenarioCountry, readonly string[]>> = {
  DE: ['Берлин', 'Мюнхен', 'Гамбург', 'Франкфурт-на-Майне', 'Кёльн', 'Штутгарт', 'Дюссельдорф'],
  CY: ['Лимасол', 'Никосия', 'Ларнака', 'Пафос'],
  RS: ['Белград', 'Нови-Сад', 'Ниш'],
  AE: ['Дубай', 'Абу-Даби', 'Шарджа'],
  GE: ['Тбилиси', 'Батуми', 'Кутаиси'],
  RU: ['Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань', 'Нижний Новгород'],
};

/** ISO 4217 codes the editor accepts for comparison rates and visa funds. */
export const RELOCATION_CURRENCIES = ['EUR', 'USD', 'RUB', 'RSD', 'AED', 'GEL', 'GBP', 'KZT'] as const;

/** Partner and children from the questionnaire; unknown answers start as «one person, no children». */
export function scenarioFamilyFromProfile(profile: RelocationQuestionnaire | null): ScenarioFamily {
  return {
    hasPartner: profile?.family.partnerStatus === 'has_partner',
    children: profile?.family.childrenCount ?? 0,
  };
}

/** Everyone who moves is in the budget: the candidate, the partner and every child. */
export function scenarioHouseholdSize(family: ScenarioFamily): number {
  return 1 + (family.hasPartner ? 1 : 0) + family.children;
}

/**
 * Germany charges childless employees a care-insurance surcharge, so the family decides it;
 * the other payroll options stay as the candidate chose them.
 */
export function scenarioPayrollOptions(
  countryCode: string,
  family: ScenarioFamily,
  options: PayrollOptions,
): PayrollOptions {
  const { germanyChildless: _ignored, ...rest } = options;
  return countryCode === 'DE' ? { ...rest, germanyChildless: family.children === 0 } : rest;
}
