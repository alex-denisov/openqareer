import type { TaxDataSource } from '../taxData/types';
import {
  MOBILITY_SCENARIO_IDS,
  type CountryMobilityData,
  type MobilityPath,
  type MobilityRequirement,
  type MobilityScenarioDefinition,
  type MobilityScenarioId,
} from './types';

const retrievedAt = '2026-10-10';

const source = (title: string, url: string, dataYear = 2026): TaxDataSource => ({
  title,
  url,
  dataYear,
  retrievedAt,
});

const sources = {
  eaeu: source(
    'Договор о Евразийском экономическом союзе, статья 97',
    'https://old.adilet.zan.kz/eng/docs/Z1400000240',
    2015,
  ),
  euFreeMovement: source(
    'Европейский союз: право граждан ЕС работать в другой стране ЕС',
    'https://europa.eu/youreurope/citizens/work/work-abroad/index_en.htm',
  ),
  germanBlueCard: source(
    'Правительство Германии: требования EU Blue Card и пороги зарплаты на 2026 год',
    'https://www.make-it-in-germany.com/en/visa-residence/types/eu-blue-card',
  ),
  germanOpportunityCard: source(
    'Правительство Германии: Chancenkarte, баллы и средства на 2026 год',
    'https://www.make-it-in-germany.com/en/visa-residence/opportunity-card/job-search',
  ),
  ukSkilledWorker: source(
    'GOV.UK: требования Skilled Worker, минимальная зарплата и ставка профессии',
    'https://www.gov.uk/skilled-worker-visa/your-job',
  ),
  uaeEmployment: source(
    'Официальный портал ОАЭ: предложение о работе, разрешение и рабочая резиденция',
    'https://u.ae/en/information-and-services/jobs/employment-in-the-private-sector/job-offers-and-work-permits-and-contracts/expatriates-employment-in-private-sector',
  ),
  uaeJobSeeker: source(
    'Официальный портал ОАЭ: виза для поиска работы и критерии образования/квалификации',
    'https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/jobseeker-visit-visa',
  ),
  uaeRemoteWork: source(
    'Официальный портал ОАЭ: виртуальная резиденция, удалённая работа и доход',
    'https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/residence-visa-for-working-outside-the-uae',
  ),
  serbiaWork: source(
    'Правительство Сербии: единый ВНЖ и разрешение на работу для иностранцев',
    'https://welcometoserbia.gov.rs/residence-and-work-permit',
  ),
  cyprusDigitalNomad: source(
    'Migration Department of Cyprus: Digital Nomad Visa, доход и семейные надбавки',
    'https://www.gov.cy/mip-md/en/documents/digital-nomads-and-family-members/',
    2025,
  ),
};

const labels: Readonly<Record<MobilityScenarioId, string>> = {
  domestic_market: 'Домашний рынок',
  employer_sponsorship: 'Переезд под оффер компании',
  job_seeker_visa: 'Самостоятельный поиск работы',
  digital_nomad: 'Международная удалёнка',
  simple_mobility: 'Безвизовый въезд и региональные права на работу',
};

const noDataReason =
  'Нет проверенного официального набора правил для этого маршрута. Числовые пороги не показываются.';

const noDataScenario = (id: MobilityScenarioId): MobilityScenarioDefinition => ({
  id,
  label: labels[id],
  dataStatus: 'no_data',
  paths: [],
  reason: noDataReason,
});

function scenario(
  id: MobilityScenarioId,
  paths: readonly MobilityPath[],
  reason?: string,
): MobilityScenarioDefinition {
  return { id, label: labels[id], dataStatus: 'verified', paths, ...(reason ? { reason } : {}) };
}

function path(id: string, label: string, requirements: readonly MobilityRequirement[]): MobilityPath {
  return { id, label, requirements };
}

function noDataScenarios(): MobilityScenarioDefinition[] {
  return MOBILITY_SCENARIO_IDS.map(noDataScenario);
}

function domesticScenario(countryCode: string): MobilityScenarioDefinition {
  return scenario('domestic_market', [
    path('citizen-or-resident', 'Гражданство или право на работу в стране', [
      { kind: 'domestic_right', countryCode },
    ]),
  ]);
}

function regionalScenario(
  countryCode: string,
  eligibleCitizenshipCountryCodes: readonly string[],
  evidence: TaxDataSource,
  label: string,
): MobilityScenarioDefinition {
  return scenario('simple_mobility', [
    path('regional-work-right', label, [
      {
        kind: 'regional_work_right',
        destinationCountryCodes: [countryCode],
        eligibleCitizenshipCountryCodes,
        source: evidence,
        explanation: 'Право на работу проверяется по гражданству и стране назначения.',
      },
    ]),
  ]);
}

const eaeuMembers = ['AM', 'BY', 'KG', 'KZ', 'RU'] as const;
const euMembers = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT',
  'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const;

const countryNames: Readonly<Record<string, string>> = {
  AE: 'ОАЭ',
  AM: 'Армения',
  BY: 'Беларусь',
  CA: 'Канада',
  CY: 'Кипр',
  DE: 'Германия',
  ES: 'Испания',
  GB: 'Великобритания',
  GE: 'Грузия',
  KG: 'Кыргызстан',
  KZ: 'Казахстан',
  PT: 'Португалия',
  RS: 'Сербия',
  RU: 'Россия',
  SG: 'Сингапур',
  TR: 'Турция',
  US: 'США',
};

const countries: Readonly<Record<string, CountryMobilityData>> = {
  RU: {
    countryCode: 'RU',
    name: 'Россия',
    scenarios: [
      domesticScenario('RU'),
      noDataScenario('employer_sponsorship'),
      noDataScenario('job_seeker_visa'),
      noDataScenario('digital_nomad'),
      regionalScenario('RU', eaeuMembers, sources.eaeu, 'Работа для граждан государств ЕАЭС'),
    ],
  },
  KZ: {
    countryCode: 'KZ',
    name: 'Казахстан',
    scenarios: [
      domesticScenario('KZ'),
      noDataScenario('employer_sponsorship'),
      noDataScenario('job_seeker_visa'),
      noDataScenario('digital_nomad'),
      regionalScenario('KZ', eaeuMembers, sources.eaeu, 'Работа для граждан государств ЕАЭС'),
    ],
  },
  RS: {
    countryCode: 'RS',
    name: 'Сербия',
    scenarios: [
      domesticScenario('RS'),
      scenario('employer_sponsorship', [
        path('single-residence-and-work-permit', 'Единый ВНЖ и разрешение на работу', [
          {
            kind: 'job_offer',
            source: sources.serbiaWork,
            explanation: 'Для местной работы иностранцу требуется оформленный единый ВНЖ и разрешение на работу.',
          },
        ]),
      ]),
      noDataScenario('job_seeker_visa'),
      noDataScenario('digital_nomad'),
      scenario(
        'simple_mobility',
        [
          path('visa-free-entry-needs-work-check', 'Безвизовый въезд не равен общему праву на работу', [
            {
              kind: 'work_authorization',
              shortTermExceptionMaximumDays: 90,
              source: sources.serbiaWork,
              explanation:
                'Сербия не входит в ЕАЭС. Для местной работы нужно подтвердить единый ВНЖ/разрешение или конкретное краткосрочное исключение по виду работы и сроку пребывания.',
            },
          ]),
        ],
      ),
    ],
  },
  AE: {
    countryCode: 'AE',
    name: 'ОАЭ',
    scenarios: [
      domesticScenario('AE'),
      scenario('employer_sponsorship', [
        path('employer-work-permit', 'Рабочее разрешение по предложению работодателя', [
          {
            kind: 'job_offer',
            source: sources.uaeEmployment,
            explanation: 'Работодатель подаёт заявление на разрешение на работу после оформленного предложения.',
          },
          {
            kind: 'approved_sponsor',
            source: sources.uaeEmployment,
            explanation: 'Работодатель должен быть зарегистрирован и иметь право нанимать работников.',
          },
        ]),
      ]),
      scenario('job_seeker_visa', [
        path('skilled-worker-search-visa', 'Виза для поиска работы: квалифицированный специалист', [
          {
            kind: 'job_seeker_category',
            source: sources.uaeJobSeeker,
            explanation: 'Нужно соответствовать профессиональному уровню 1–3 по классификации MOHRE.',
          },
          {
            kind: 'bachelor_degree',
            source: sources.uaeJobSeeker,
            explanation: 'Требуется степень бакалавра или эквивалент.',
          },
          {
            kind: 'financial_guarantee',
            source: sources.uaeJobSeeker,
            explanation: 'Нужно выполнить установленное требование к финансовой гарантии.',
          },
          {
            kind: 'private_health_insurance',
            source: sources.uaeJobSeeker,
            explanation: 'Требуется действующая медицинская страховка в ОАЭ.',
          },
        ]),
        path('recent-top-university-graduate', 'Виза для поиска работы: недавний выпускник рейтингового университета', [
          {
            kind: 'recent_top_university_graduate',
            amount: 2,
            source: sources.uaeJobSeeker,
            explanation: 'Выпуск не более двух лет назад из университета из утверждённого списка 500 лучших.',
          },
          {
            kind: 'bachelor_degree',
            source: sources.uaeJobSeeker,
            explanation: 'Требуется степень бакалавра или эквивалент.',
          },
          {
            kind: 'financial_guarantee',
            source: sources.uaeJobSeeker,
            explanation: 'Нужно выполнить установленное требование к финансовой гарантии.',
          },
          {
            kind: 'private_health_insurance',
            source: sources.uaeJobSeeker,
            explanation: 'Требуется действующая медицинская страховка в ОАЭ.',
          },
        ]),
      ]),
      scenario('digital_nomad', [
        path('virtual-work-residence', 'Годовая виртуальная резиденция для удалённой работы', [
          {
            kind: 'foreign_remote_employment',
            source: sources.uaeRemoteWork,
            explanation: 'Работа должна выполняться для компании за пределами ОАЭ.',
          },
          {
            kind: 'minimum_remote_income',
            amount: 3_500,
            currency: 'USD',
            incomeBasis: 'unspecified',
            source: sources.uaeRemoteWork,
            explanation: 'Нужна справка о зарплате не ниже порога.',
          },
          {
            kind: 'private_health_insurance',
            source: sources.uaeRemoteWork,
            explanation: 'Требуется медицинская страховка.',
          },
        ]),
      ]),
      noDataScenario('simple_mobility'),
    ],
  },
  DE: {
    countryCode: 'DE',
    name: 'Германия',
    scenarios: [
      domesticScenario('DE'),
      scenario('employer_sponsorship', [
        path('eu-blue-card-standard', 'EU Blue Card: общий порог', [
          {
            kind: 'job_offer',
            source: sources.germanBlueCard,
            explanation: 'Нужно предложение квалифицированной работы не менее чем на шесть месяцев.',
          },
          {
            kind: 'recognized_degree',
            source: sources.germanBlueCard,
            explanation: 'Нужна сопоставимая квалификация; работа должна соответствовать квалификации.',
          },
          {
            kind: 'minimum_annual_salary',
            amount: 50_700,
            currency: 'EUR',
            source: sources.germanBlueCard,
            explanation: 'Общий порог валовой годовой зарплаты на 2026 год.',
          },
        ]),
        path('eu-blue-card-reduced-threshold', 'EU Blue Card: сниженный порог по предусмотренному основанию', [
          {
            kind: 'job_offer',
            source: sources.germanBlueCard,
            explanation: 'Нужно предложение квалифицированной работы не менее чем на шесть месяцев.',
          },
          {
            kind: 'recognized_degree',
            source: sources.germanBlueCard,
            explanation: 'Нужна сопоставимая квалификация; работа должна соответствовать квалификации.',
          },
          {
            kind: 'blue_card_exception_eligible',
            source: sources.germanBlueCard,
            explanation: 'Сниженный порог применяется только к предусмотренным категориям.',
          },
          {
            kind: 'minimum_annual_salary',
            amount: 45_934.2,
            currency: 'EUR',
            source: sources.germanBlueCard,
            explanation: 'Сниженный валовой годовой порог Blue Card на 2026 год.',
          },
        ]),
        path('eu-blue-card-it-experience', 'EU Blue Card для IT-специалиста без диплома', [
          {
            kind: 'job_offer',
            source: sources.germanBlueCard,
            explanation: 'Нужно предложение работы в IT не менее чем на шесть месяцев.',
          },
          {
            kind: 'it_professional',
            source: sources.germanBlueCard,
            explanation: 'Маршрут действует для IT-профессии, требующей навыков уровня высшего образования.',
          },
          {
            kind: 'minimum_experience_years',
            amount: 3,
            withinYears: 7,
            source: sources.germanBlueCard,
            explanation: 'Нужно не менее трёх лет релевантного IT-опыта за последние семь лет.',
          },
          {
            kind: 'minimum_annual_salary',
            amount: 45_934.2,
            currency: 'EUR',
            source: sources.germanBlueCard,
            explanation: 'Сниженный валовой годовой порог Blue Card на 2026 год.',
          },
        ]),
      ]),
      scenario('job_seeker_visa', [
        path('opportunity-card-recognized-qualification', 'Chancenkarte: признанная квалификация', [
          {
            kind: 'recognized_degree',
            source: sources.germanOpportunityCard,
            explanation: 'Нужна полностью признанная профессиональная или академическая квалификация.',
          },
          {
            kind: 'minimum_monthly_funds',
            amount: 1_091,
            currency: 'EUR',
            source: sources.germanOpportunityCard,
            explanation: 'Минимум средств на проживание за месяц в 2026 году.',
          },
        ]),
        path('opportunity-card-points', 'Chancenkarte: балльная система', [
          {
            kind: 'completed_qualification',
            source: sources.germanOpportunityCard,
            explanation: 'Нужно завершённое профессиональное или академическое обучение.',
          },
          {
            kind: 'meets_language_requirements',
            source: sources.germanOpportunityCard,
            explanation: 'Для балльного маршрута нужен немецкий A1 или английский B2.',
          },
          {
            kind: 'minimum_job_seeker_points',
            amount: 6,
            source: sources.germanOpportunityCard,
            explanation: 'Минимум шесть баллов по официальной системе.',
          },
          {
            kind: 'minimum_monthly_funds',
            amount: 1_091,
            currency: 'EUR',
            source: sources.germanOpportunityCard,
            explanation: 'Минимум средств на проживание за месяц в 2026 году.',
          },
        ]),
      ]),
      noDataScenario('digital_nomad'),
      regionalScenario('DE', euMembers, sources.euFreeMovement, 'Свободное передвижение граждан ЕС'),
    ],
  },
  GB: {
    countryCode: 'GB',
    name: 'Великобритания',
    scenarios: [
      domesticScenario('GB'),
      scenario('employer_sponsorship', [
        path('skilled-worker-standard', 'Skilled Worker: общий маршрут', [
          {
            kind: 'job_offer',
            source: sources.ukSkilledWorker,
            explanation: 'Нужно предложение работы от одобренного работодателя.',
          },
          {
            kind: 'approved_sponsor',
            source: sources.ukSkilledWorker,
            explanation: 'Работодатель должен иметь разрешение Home Office на спонсорство.',
          },
          {
            kind: 'occupation_eligible',
            source: sources.ukSkilledWorker,
            explanation: 'Код профессии должен подходить для Skilled Worker.',
          },
          {
            kind: 'minimum_annual_salary',
            amount: 41_700,
            currency: 'GBP',
            source: sources.ukSkilledWorker,
            explanation: 'Обычно нужна зарплата не ниже £41 700 и ставки для конкретной профессии — применяется большая из них.',
          },
          {
            kind: 'going_rate_met',
            source: sources.ukSkilledWorker,
            explanation: 'Зарплата должна также достигать going rate по коду профессии.',
          },
        ]),
      ]),
      noDataScenario('job_seeker_visa'),
      noDataScenario('digital_nomad'),
      noDataScenario('simple_mobility'),
    ],
  },
  US: {
    countryCode: 'US',
    name: 'США',
    scenarios: [
      domesticScenario('US'),
      noDataScenario('employer_sponsorship'),
      noDataScenario('job_seeker_visa'),
      noDataScenario('digital_nomad'),
      noDataScenario('simple_mobility'),
    ],
  },
  CY: {
    countryCode: 'CY',
    name: 'Кипр',
    scenarios: [
      domesticScenario('CY'),
      noDataScenario('employer_sponsorship'),
      noDataScenario('job_seeker_visa'),
      scenario('digital_nomad', [
        path('cyprus-digital-nomad', 'Digital Nomad residence permit', [
          {
            kind: 'foreign_remote_employment',
            source: sources.cyprusDigitalNomad,
            explanation: 'Работа или клиенты должны находиться за пределами Кипра.',
          },
          {
            kind: 'minimum_remote_income',
            amount: 3_500,
            currency: 'EUR',
            incomeBasis: 'net',
            partnerUplift: 0.2,
            childUplift: 0.15,
            source: sources.cyprusDigitalNomad,
            explanation: 'Минимум €3 500 чистого дохода в месяц; +20% для партнёра и +15% на каждого ребёнка.',
          },
          {
            kind: 'private_health_insurance',
            source: sources.cyprusDigitalNomad,
            explanation: 'Нужно подтверждение медицинской страховки.',
          },
        ]),
      ]),
      regionalScenario('CY', euMembers, sources.euFreeMovement, 'Свободное передвижение граждан ЕС'),
    ],
  },
};

export function getCountryMobilityData(countryCode: string): CountryMobilityData {
  const code = countryCode.trim().toUpperCase();
  const existing = countries[code];
  if (existing) return existing;

  const name = countryNames[code] ?? code;
  const eaeu = (eaeuMembers as readonly string[]).includes(code);
  const eu = (euMembers as readonly string[]).includes(code);
  const scenarios = noDataScenarios();
  scenarios[0] = domesticScenario(code);
  if (eaeu) scenarios[4] = regionalScenario(code, eaeuMembers, sources.eaeu, 'Работа для граждан государств ЕАЭС');
  if (eu) scenarios[4] = regionalScenario(code, euMembers, sources.euFreeMovement, 'Свободное передвижение граждан ЕС');
  return { countryCode: code, name, scenarios };
}

export const COUNTRY_FIT_DISCLAIMER =
  'Справочная информация по открытым источникам, не юридическая консультация. Пороги и правила меняются: перед решением проверьте на официальном портале страны.';

export function isNumberRequirement(requirement: MobilityRequirement): requirement is Extract<
  MobilityRequirement,
  { readonly amount: number }
> {
  return 'amount' in requirement;
}

export function getVisibleThresholdSource(requirement: MobilityRequirement): TaxDataSource | null {
  if (!isNumberRequirement(requirement)) return null;
  const candidate = requirement as MobilityRequirement & { readonly source?: TaxDataSource };
  const evidence = candidate.source;
  if (
    !evidence ||
    !evidence.title ||
    !Number.isInteger(evidence.dataYear) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(evidence.retrievedAt)
  ) return null;
  try {
    if (new URL(evidence.url).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return evidence;
}

export function getCountryMobilityScenarioIds(): readonly MobilityScenarioId[] {
  return MOBILITY_SCENARIO_IDS;
}
