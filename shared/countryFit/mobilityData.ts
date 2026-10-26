import type { TaxDataSource } from '../taxData/types';
import { isVerifiableSource, sources } from './mobilitySources';
import {
  domesticScenario,
  noDataScenario,
  noDataScenarios,
  path,
  regionalScenario,
  scenario,
} from './mobilityScenarioBuilders';
import * as routes from './mobilityRoutes';
import {
  MOBILITY_SCENARIO_IDS,
  type CountryMobilityData,
  type MobilityRequirement,
  type MobilityScenarioId,
} from './types';

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
      routes.russiaEmployer,
      routes.russiaJobSeeker,
      routes.russiaRemote,
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
      routes.serbiaJobSeeker,
      routes.serbiaRemote,
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
            kind: 'manual_check',
            source: sources.uaeEmployment,
            explanation: 'После подписания договора работодатель оформляет разрешение на работу, затем рабочую визу.',
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
            explanation: 'Нужно подтвердить доход не ниже $3 500 в месяц.',
          },
          {
            kind: 'private_health_insurance',
            source: sources.uaeRemoteWork,
            explanation: 'Требуется медицинская страховка.',
          },
        ]),
      ]),
      routes.uaeLocalWork,
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
      routes.germanyRemote,
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
      routes.ukJobSeeker,
      routes.ukRemote,
      routes.ukLocalWork,
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
      routes.cyprusEmployer,
      routes.cyprusJobSeeker,
      routes.cyprusRemote,
      regionalScenario('CY', euMembers, sources.euFreeMovement, 'Свободное передвижение граждан ЕС'),
    ],
  },
  GE: {
    countryCode: 'GE',
    name: 'Грузия',
    scenarios: [
      domesticScenario('GE'),
      routes.georgiaEmployer,
      routes.georgiaJobSeeker,
      routes.georgiaRemote,
      routes.georgiaLocalWork,
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
  return isVerifiableSource(candidate.source) ? candidate.source : null;
}

export { isVerifiableSource } from './mobilitySources';

export function getCountryMobilityScenarioIds(): readonly MobilityScenarioId[] {
  return MOBILITY_SCENARIO_IDS;
}
