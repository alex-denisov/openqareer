import { getCountryMobilityData, getVisibleThresholdSource, isNumberRequirement, isVerifiableSource } from './mobilityData';
import { residenceRightIn } from './residenceDocuments';
import { calculateGermanOpportunityCardPoints, germanOpportunityCardLanguageGate } from './germanyOpportunityCard';
import type {
  CountryFitEvaluation,
  CountryFitStatus,
  MobilityCandidateProfile,
  MobilityPath,
  MobilityPathEvaluation,
  MobilityRequirement,
  MobilityScenarioDefinition,
  MobilityScenarioEvaluation,
  ScenarioAvailability,
  SourcedThreshold,
} from './types';

export interface RequirementEvaluation {
  readonly status: 'satisfied' | 'barrier' | 'unknown';
  readonly reason?: string;
  readonly threshold?: SourcedThreshold;
  readonly sourceUrl?: string;
}

function sourceIsValid(requirement: MobilityRequirement): boolean {
  return !('source' in requirement) || isVerifiableSource(requirement.source);
}

function thresholdPeriod(requirement: MobilityRequirement): SourcedThreshold['period'] | null {
  switch (requirement.kind) {
    case 'minimum_annual_salary':
      return 'annual';
    case 'minimum_offer_salary':
      return requirement.per === 'quarter' ? 'quarterly' : 'monthly';
    case 'minimum_savings':
      return 'one_time';
    case 'minimum_remote_income':
    case 'minimum_monthly_funds':
      return 'monthly';
    case 'minimum_job_seeker_points':
      return 'points';
    case 'minimum_experience_years':
    case 'recent_top_university_graduate':
      return 'years';
    default:
      return null;
  }
}

function thresholdLabel(requirement: MobilityRequirement): string {
  switch (requirement.kind) {
    case 'minimum_annual_salary':
      return 'Минимальная годовая зарплата';
    case 'minimum_offer_salary':
      return requirement.per === 'quarter' ? 'Минимальная зарплата за квартал' : 'Минимальная месячная зарплата';
    case 'minimum_savings':
      return 'Личные сбережения на счёте';
    case 'minimum_remote_income':
      return requirement.incomeBasis === 'net' ? 'Минимальный чистый доход в месяц' : 'Минимальный доход в месяц';
    case 'minimum_monthly_funds':
      return 'Средства на проживание в месяц';
    case 'minimum_job_seeker_points':
      return 'Минимум баллов';
    case 'minimum_experience_years':
      return 'Релевантный стаж';
    case 'recent_top_university_graduate':
      return 'Максимальный срок после окончания университета из списка';
    default:
      return requirement.kind;
  }
}

function visibleThreshold(
  requirement: MobilityRequirement,
  countryCode: string,
  candidate: MobilityCandidateProfile,
): SourcedThreshold | undefined {
  if (!isNumberRequirement(requirement)) return undefined;
  const source = getVisibleThresholdSource(requirement);
  const period = thresholdPeriod(requirement);
  if (!source || !period) return undefined;

  let amount = requirement.amount;
  if (requirement.kind === 'minimum_remote_income') {
    const hasFamilyUplifts = requirement.partnerUplift !== undefined || requirement.childUplift !== undefined;
    if (hasFamilyUplifts && !candidate.family) return undefined;
    const partnerMultiplier = candidate.family?.hasPartner ? requirement.partnerUplift ?? 0 : 0;
    const childMultiplier = (candidate.family?.children ?? 0) * (requirement.childUplift ?? 0);
    amount = Number((requirement.amount * (1 + partnerMultiplier + childMultiplier)).toFixed(2));
  }

  return {
    requirement: requirement.kind,
    label: thresholdLabel(requirement),
    amount,
    ...('currency' in requirement ? { currency: requirement.currency } : {}),
    period,
    source,
  };
}

function missing(reason: string): RequirementEvaluation {
  return { status: 'unknown', reason };
}

function fails(reason: string): RequirementEvaluation {
  return { status: 'barrier', reason };
}

function passes(): RequirementEvaluation {
  return { status: 'satisfied' };
}

function candidateAmountMatches(
  candidateAmount: { readonly amount: number; readonly currency: string } | undefined,
  thresholdAmount: number,
  currency: string,
  missingReason: string,
): RequirementEvaluation {
  if (!candidateAmount) return missing(missingReason);
  if (!Number.isFinite(candidateAmount.amount) || candidateAmount.amount < 0) {
    return missing('Сумма в анкете должна быть конечным неотрицательным числом.');
  }
  if (candidateAmount.currency.toUpperCase() !== currency.toUpperCase()) {
    return missing(`Для сравнения нужен доход в ${currency}; пересчёт валюты без источника курса не выполняется.`);
  }
  if (candidateAmount.amount < thresholdAmount) return fails('Указанная сумма ниже официального порога.');
  return passes();
}

export function evaluateRequirement(
  requirement: MobilityRequirement,
  countryCode: string,
  candidate: MobilityCandidateProfile,
): RequirementEvaluation {
  if (!sourceIsValid(requirement)) return missing('Для правила нет проверяемого источника; числовой порог скрыт.');
  const threshold = visibleThreshold(requirement, countryCode, candidate);
  const thresholdInfo = threshold ? { threshold, sourceUrl: threshold.source.url } : {};
  let result: RequirementEvaluation;

  switch (requirement.kind) {
    case 'domestic_right': {
      if (candidate.currentCountryCode?.toUpperCase() === requirement.countryCode) return passes();
      if (candidate.citizenshipCountryCodes?.some((code) => code.toUpperCase() === requirement.countryCode)) {
        return passes();
      }
      const residence = residenceRightIn(requirement.countryCode, candidate.residenceDocuments, candidate.asOf);
      if (residence) return { status: residence.valid ? 'satisfied' : 'barrier', reason: residence.reason };
      const hasCitizenship = Boolean(candidate.citizenshipCountryCodes?.length);
      if (!candidate.currentCountryCode || !hasCitizenship) {
        return missing('Укажите гражданство или текущую страну проживания.');
      }
      return fails('Страна не совпадает с гражданством или текущей страной проживания.');
    }
    case 'regional_work_right': {
      if (!requirement.destinationCountryCodes.includes(countryCode)) return fails('Для этой страны региональное право на работу не действует.');
      const citizenship = candidate.citizenshipCountryCodes;
      if (!citizenship || citizenship.length === 0) return missing('Укажите гражданство в анкете.');
      if (!citizenship.some((code) => requirement.eligibleCitizenshipCountryCodes.includes(code.toUpperCase()))) {
        return fails('Гражданство не входит в перечень стран с этим правом на работу.');
      }
      return passes();
    }
    case 'visa_free_stay': {
      const citizenship = candidate.citizenshipCountryCodes;
      if (!citizenship || citizenship.length === 0) return missing('Укажите гражданство в анкете.');
      if (!citizenship.some((code) => requirement.eligibleCitizenshipCountryCodes.includes(code.toUpperCase()))) {
        return missing('Безвизовый режим для этого гражданства не проверен; проверьте его на официальном сайте страны.');
      }
      if (candidate.stayDurationDays !== undefined && candidate.stayDurationDays > requirement.maximumStayDays) {
        return fails('Планируемый срок дольше безвизового пребывания.');
      }
      return passes();
    }
    case 'manual_check':
      return missing(requirement.explanation);
    case 'job_offer':
      if (candidate.hasJobOffer === undefined) return missing('Укажите, есть ли предложение работы для этой страны.');
      result = candidate.hasJobOffer ? passes() : fails('Для этого маршрута нужен оффер от работодателя.');
      break;
    case 'approved_sponsor':
      if (candidate.approvedEmployerSponsor === undefined) return missing('Проверьте, одобрен ли работодатель для спонсорства.');
      result = candidate.approvedEmployerSponsor ? passes() : fails('Работодатель не подтверждён как разрешённый спонсор.');
      break;
    case 'occupation_eligible':
      if (candidate.occupationEligible === undefined) return missing('Укажите код или категорию профессии для проверки списка.');
      result = candidate.occupationEligible ? passes() : fails('Профессия не подтверждена как подходящая для маршрута.');
      break;
    case 'going_rate_met':
      if (candidate.occupationGoingRateMet === undefined) return missing('Нужна ставка для конкретного кода профессии.');
      result = candidate.occupationGoingRateMet ? passes() : fails('Зарплата ниже ставки для выбранного кода профессии.');
      break;
    case 'recognized_degree':
      if (!candidate.recognizedDegreeCountryCodes) return missing('Укажите, признана ли квалификация в этой стране.');
      result = candidate.recognizedDegreeCountryCodes.includes(countryCode)
        ? passes()
        : fails('Признание квалификации для этой страны не подтверждено.');
      break;
    case 'completed_qualification':
      if (candidate.completedFormalQualification === undefined) return missing('Заполните раздел образования.');
      result = candidate.completedFormalQualification ? passes() : fails('Для этого маршрута требуется завершённое обучение.');
      break;
    case 'blue_card_exception_eligible':
      if (candidate.blueCardExceptionEligible === undefined) return missing('Нужно проверить профессию или дату получения квалификации для сниженного порога.');
      result = candidate.blueCardExceptionEligible ? passes() : fails('Сниженный порог для этого основания не подтверждён.');
      break;
    case 'it_professional':
      if (candidate.isItProfessional === undefined) return missing('Нужно подтвердить, что предложение относится к квалифицированной IT-работе.');
      result = candidate.isItProfessional ? passes() : fails('Маршрут без диплома относится только к подходящей IT-профессии.');
      break;
    case 'meets_language_requirements': {
      const value =
        candidate.meetsLanguageRequirementsByCountry?.[countryCode] ??
        (countryCode === 'DE' && candidate.germanyOpportunityCard
          ? germanOpportunityCardLanguageGate(candidate.germanyOpportunityCard)
          : undefined);
      if (value === undefined) return missing('Укажите подтверждённый уровень языка.');
      result = value ? passes() : fails('Подтверждённый уровень языка не соответствует минимуму маршрута.');
      break;
    }
    case 'bachelor_degree':
      if (candidate.hasBachelorDegree === undefined) return missing('Укажите уровень завершённого образования.');
      result = candidate.hasBachelorDegree ? passes() : fails('Для этого маршрута требуется степень бакалавра или эквивалент.');
      break;
    case 'job_seeker_category': {
      const value = candidate.jobSeekerCategoryEligibleByCountry?.[countryCode];
      if (value === undefined) return missing('Проверьте профессиональную категорию по правилам страны.');
      result = value ? passes() : fails('Профессиональная категория не подходит под требования визы.');
      break;
    }
    case 'recent_top_university_graduate': {
      const years = candidate.recentTopUniversityGraduateWithinYearsByCountry?.[countryCode];
      if (years === undefined) return missing('Укажите дату окончания и проверьте список университетов.');
      result = years <= requirement.amount
        ? passes()
        : fails('Выпуск произошёл раньше установленного срока.');
      break;
    }
    case 'financial_guarantee':
      if (!candidate.financialGuaranteeSatisfiedByCountry) return missing('Подтвердите наличие требуемой финансовой гарантии.');
      result = candidate.financialGuaranteeSatisfiedByCountry.includes(countryCode)
        ? passes()
        : fails('Финансовая гарантия для этой страны не подтверждена.');
      break;
    case 'minimum_annual_salary':
      result = candidateAmountMatches(
        candidate.annualOfferSalary,
        requirement.amount,
        requirement.currency,
        'Укажите ожидаемую годовую зарплату по офферу.',
      );
      break;
    case 'minimum_offer_salary': {
      const months = requirement.per === 'quarter' ? 3 : 1;
      const monthly = candidate.monthlyOfferSalary;
      result = candidateAmountMatches(
        monthly && { amount: monthly.amount * months, currency: monthly.currency },
        requirement.amount,
        requirement.currency,
        'Укажите месячную зарплату по офферу до налогов.',
      );
      break;
    }
    case 'minimum_savings':
      result = candidateAmountMatches(
        candidate.availableSavings,
        requirement.amount,
        requirement.currency,
        'Укажите личные сбережения на счёте.',
      );
      break;
    case 'minimum_job_seeker_points': {
      const score =
        countryCode === 'DE' && candidate.germanyOpportunityCard
          ? calculateGermanOpportunityCardPoints(candidate.germanyOpportunityCard)
          : null;
      if (!score) return missing('Заполните профиль, чтобы посчитать баллы по критериям страны.');
      if (score.points >= requirement.amount) return passes();
      result = !score.complete
        ? missing(`Известных баллов недостаточно; не хватает данных: ${score.missingCriteria.join(', ')}.`)
        : fails('Баллов недостаточно для визового маршрута.');
      break;
    }
    case 'minimum_monthly_funds':
      result = candidateAmountMatches(
        candidate.minimumMonthlyFunds,
        requirement.amount,
        requirement.currency,
        'Укажите подтверждаемые средства на проживание в месяц.',
      );
      break;
    case 'minimum_remote_income': {
      if (
        (requirement.partnerUplift !== undefined || requirement.childUplift !== undefined) &&
        !candidate.family
      ) {
        return missing('Укажите состав семьи, чтобы учесть надбавки к порогу дохода.');
      }
      if (requirement.incomeBasis === 'net' && candidate.remoteMonthlyIncomeIsNet !== true) {
        return missing('Порог задан по чистому доходу; укажите подтверждённую сумму после налогов и взносов.');
      }
      if (requirement.incomeBasis === 'gross' && candidate.remoteMonthlyIncomeIsNet !== false) {
        return missing('Порог задан по валовому доходу; уточните базу указанной суммы.');
      }
      result = candidateAmountMatches(
        candidate.remoteMonthlyIncome,
        threshold?.amount ?? requirement.amount,
        requirement.currency,
        'Укажите регулярный доход от удалённой работы в месяц.',
      );
      break;
    }
    case 'foreign_remote_employment':
      if (candidate.worksRemotelyForForeignEmployer === undefined) return missing('Укажите, работаете ли вы на работодателя или клиентов за пределами страны.');
      result = candidate.worksRemotelyForForeignEmployer ? passes() : fails('Маршрут разрешает удалённую работу только на работодателя или клиентов за рубежом.');
      break;
    case 'private_health_insurance':
      if (candidate.hasPrivateHealthInsurance === undefined) return missing('Укажите наличие медицинской страховки для страны.');
      result = candidate.hasPrivateHealthInsurance ? passes() : fails('Для маршрута нужна действующая медицинская страховка.');
      break;
    case 'minimum_experience_years':
      {
        const experienceYears = requirement.withinYears
          ? candidate.relevantExperienceYearsByWindow?.[String(requirement.withinYears)]
          : candidate.relevantExperienceYears;
        if (experienceYears === undefined) return missing('Укажите подтверждённый стаж за требуемый период.');
        result = experienceYears >= requirement.amount ? passes() : fails('Подтверждённого стажа меньше установленного минимума.');
      }
      break;
    case 'work_authorization':
      if (candidate.hasLocalWorkAuthorizationCountryCodes?.includes(countryCode)) return passes();
      if (candidate.shortTermWorkExceptionByCountry?.[countryCode] === false) {
        return fails('Краткосрочное исключение к разрешению на работу не подтверждено.');
      }
      if (candidate.shortTermWorkExceptionByCountry?.[countryCode] === true) {
        if (candidate.stayDurationDays === undefined) return missing('Укажите планируемую длительность работы и пребывания.');
        if (requirement.shortTermExceptionMaximumDays === undefined) {
          return missing('Для краткосрочного исключения не найден проверенный срок.');
        }
        result = candidate.stayDurationDays <= requirement.shortTermExceptionMaximumDays
          ? passes()
          : fails('Краткосрочное исключение не применяется к заявленному сроку.');
        break;
      }
      return missing('Проверьте право на местную работу: безвизовый въезд сам по себе его не подтверждает.');
  }

  return { ...result, ...thresholdInfo };
}

function evaluatePath(path: MobilityPath, countryCode: string, candidate: MobilityCandidateProfile): MobilityPathEvaluation {
  const evaluations = path.requirements.map((requirement) => evaluateRequirement(requirement, countryCode, candidate));
  const statuses = evaluations.map(({ status }) => status);
  const status: ScenarioAvailability =
    statuses.length === 0 || statuses.includes('unknown')
      ? 'unknown'
      : statuses.includes('barrier')
        ? 'barriers'
        : 'available';
  const reasons = evaluations.flatMap(({ reason }) => (reason ? [reason] : []));
  const thresholds = evaluations.flatMap(({ threshold }) => (threshold ? [threshold] : []));
  const sources = uniqueSources(evaluations.flatMap(({ sourceUrl }) => (sourceUrl ? [sourceUrl] : [])), path.requirements);
  return { id: path.id, label: path.label, status, reasons, thresholds, sources };
}

function uniqueSources(urls: readonly string[], requirements: readonly MobilityRequirement[]) {
  const uniqueUrls = new Set(urls);
  return requirements.flatMap((requirement) => {
    if (!('source' in requirement) || !uniqueUrls.has(requirement.source.url)) return [];
    uniqueUrls.delete(requirement.source.url);
    return [requirement.source];
  });
}

function evaluateScenario(
  definition: MobilityScenarioDefinition,
  countryCode: string,
  candidate: MobilityCandidateProfile,
): MobilityScenarioEvaluation {
  if (definition.dataStatus === 'no_data') {
    return {
      id: definition.id,
      label: definition.label,
      status: 'unknown',
      reasons: [definition.reason ?? 'Нет проверенных данных для этого маршрута.'],
      thresholds: [],
      sources: [],
      paths: [],
    };
  }
  if (definition.dataStatus === 'unavailable') {
    return {
      id: definition.id,
      label: definition.label,
      status: 'unavailable',
      reasons: [definition.reason ?? 'Официальный источник подтверждает, что этот маршрут недоступен.'],
      thresholds: [],
      sources: (definition.sources ?? []).filter(isVerifiableSource),
      paths: [],
    };
  }

  const paths = definition.paths.map((path) => evaluatePath(path, countryCode, candidate));
  const pathStatuses = paths.map(({ status }) => status);
  const status: ScenarioAvailability =
    pathStatuses.includes('available')
      ? 'available'
      : pathStatuses.includes('unknown')
        ? 'unknown'
        : pathStatuses.includes('barriers')
          ? 'barriers'
          : 'unavailable';
  const selectedPaths = status === 'available' ? paths.filter(({ status: pathStatus }) => pathStatus === 'available') : paths;
  return {
    id: definition.id,
    label: definition.label,
    status,
    reasons: selectedPaths.flatMap(({ reasons }) => reasons),
    thresholds: paths.flatMap(({ thresholds }) => thresholds),
    sources: uniquePathSources(paths),
    paths,
  };
}

function uniquePathSources(paths: readonly MobilityPathEvaluation[]) {
  const seen = new Set<string>();
  return paths.flatMap(({ sources }) => sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  }));
}

function aggregateStatus(scenarios: readonly MobilityScenarioEvaluation[]): CountryFitStatus {
  if (scenarios.some(({ status }) => status === 'available')) return 'available';
  const nonDomestic = scenarios.filter(({ id }) => id !== 'domestic_market');
  if (nonDomestic.length > 0 && nonDomestic.every(({ status }) => status === 'unavailable')) {
    return 'legally_unavailable';
  }
  if (nonDomestic.some(({ status }) => status === 'barriers')) return 'high_barriers';
  return 'unknown';
}

export function evaluateCountryFit(
  countryCode: string,
  candidate: MobilityCandidateProfile,
): CountryFitEvaluation {
  const data = getCountryMobilityData(countryCode);
  const scenarios = data.scenarios.map((scenario) => evaluateScenario(scenario, data.countryCode, candidate));
  return {
    countryCode: data.countryCode,
    countryName: data.name,
    status: aggregateStatus(scenarios),
    scenarios,
  };
}

export { getCountryMobilityData } from './mobilityData';
export { COUNTRY_FIT_DISCLAIMER } from './mobilityData';
export type { CountryFitEvaluation, MobilityCandidateProfile } from './types';
