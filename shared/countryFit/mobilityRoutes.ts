/**
 * Routes checked against official pages on 2026-10-26 (see the PR table «страна × путь»).
 * A pair is either a verified set of paths or an `unavailable` answer with its source.
 */
import { sources } from './mobilitySources';
import { path, regionalScenario, scenario, unavailableScenario } from './mobilityScenarioBuilders';
import type { MobilityScenarioDefinition } from './types';

// Georgia: the right to work is required from 1 March 2026; Russians stay visa-free for a year.

export const georgiaEmployer: MobilityScenarioDefinition = scenario('employer_sponsorship', [
  path('georgia-right-to-work-via-employer', 'Право на работу через грузинского работодателя', [
    {
      kind: 'job_offer',
      source: sources.georgiaLabourMigration,
      explanation:
        'С 1 марта 2026 года иностранцу для работы в Грузии нужно право на работу. Его оформляет местный работодатель, затем выдаётся рабочая виза D1 или рабочий ВНЖ.',
    },
  ]),
]);

export const georgiaJobSeeker: MobilityScenarioDefinition = unavailableScenario(
  'job_seeker_visa',
  'Отдельной визы или ВНЖ для поиска работы в Грузии нет: закон перечисляет визы и ВНЖ для работы, учёбы, семьи, инвестиций и ИТ, но не для поиска. Искать вакансии можно во время безвизового пребывания, а работать — только после получения права на работу.',
  [sources.georgiaAliens, sources.georgiaLabourMigration],
);

export const georgiaRemote: MobilityScenarioDefinition = scenario('digital_nomad', [
  path(
    'georgia-visa-free-remote-work',
    'Безвизовое пребывание и удалённая работа на зарубежную компанию',
    [
      {
        kind: 'visa_free_stay',
        eligibleCitizenshipCountryCodes: ['RU'],
        maximumStayDays: 365,
        source: sources.georgiaVisaFree,
        explanation: 'Граждане России въезжают без визы и могут находиться в Грузии 1 год.',
      },
      {
        kind: 'foreign_remote_employment',
        source: sources.georgiaLabourMigration,
        explanation:
          'Закон о трудовой миграции не применяется к услугам для нерезидента, связанным с его деятельностью за пределами Грузии; работа на грузинские компании требует права на работу.',
      },
    ],
  ),
]);

export const georgiaLocalWork: MobilityScenarioDefinition = scenario('simple_mobility', [
  path(
    'georgia-visa-free-entry-needs-right-to-work',
    'Безвизовый въезд не даёт права работать в Грузии',
    [
      {
        kind: 'work_authorization',
        source: sources.georgiaLabourMigration,
        explanation:
          'Безвизовый въезд позволяет жить в Грузии, но с 1 марта 2026 года для работы на грузинского работодателя или своего дела там нужно право на работу.',
      },
    ],
  ),
]);

// Cyprus: hiring by companies of foreign interests; the general single-permit page was down.

const cyprusContract = {
  kind: 'job_offer',
  source: sources.cyprusForeignInterest,
  explanation: 'Нужен трудовой договор с компанией иностранного капитала не менее чем на 2 года.',
} as const;

const cyprusRegisteredCompany = {
  kind: 'approved_sponsor',
  source: sources.cyprusForeignInterest,
  explanation: 'Компания должна быть внесена в реестр компаний иностранного капитала.',
} as const;

const cyprusMonthlySalary = {
  kind: 'minimum_offer_salary',
  amount: 2_500,
  currency: 'EUR',
  per: 'month',
  source: sources.cyprusForeignInterest,
  explanation: 'Зарплата не ниже €2 500 в месяц до налогов.',
} as const;

export const cyprusEmployer: MobilityScenarioDefinition = scenario('employer_sponsorship', [
  path('cyprus-foreign-interest-degree', 'Компания иностранного капитала: профильное образование', [
    cyprusContract,
    cyprusRegisteredCompany,
    {
      kind: 'bachelor_degree',
      source: sources.cyprusForeignInterest,
      explanation: 'Нужно высшее образование, подходящее к должности.',
    },
    cyprusMonthlySalary,
  ]),
  path('cyprus-foreign-interest-experience', 'Компания иностранного капитала: опыт от 2 лет', [
    cyprusContract,
    cyprusRegisteredCompany,
    {
      kind: 'minimum_experience_years',
      amount: 2,
      source: sources.cyprusForeignInterest,
      explanation: 'Вместо диплома подходит опыт на похожей должности не меньше 2 лет.',
    },
    cyprusMonthlySalary,
  ]),
]);

export const cyprusJobSeeker: MobilityScenarioDefinition = unavailableScenario(
  'job_seeker_visa',
  'Отдельного ВНЖ для поиска работы на Кипре нет: в перечне оснований для работы иностранцев — домашний персонал, единое разрешение, другие случаи найма и сезонная работа. Разрешение выдаётся под работодателя.',
  [sources.cyprusWork],
);

export const cyprusRemote: MobilityScenarioDefinition = scenario('digital_nomad', [
  path('cyprus-digital-nomad', 'Digital Nomad residence permit', [
    {
      kind: 'foreign_remote_employment',
      source: sources.cyprusDigitalNomad,
      explanation: 'Работа на компанию, зарегистрированную за рубежом, или на зарубежных клиентов.',
    },
    {
      kind: 'minimum_remote_income',
      amount: 3_500,
      currency: 'EUR',
      incomeBasis: 'net',
      partnerUplift: 0.2,
      childUplift: 0.15,
      source: sources.cyprusDigitalNomadDocuments,
      explanation:
        'Минимум €3 500 чистого дохода в месяц; +20% для партнёра и +15% на каждого ребёнка.',
    },
    {
      kind: 'private_health_insurance',
      source: sources.cyprusDigitalNomadDocuments,
      explanation: 'Нужна медицинская страховка с амбулаторным и стационарным лечением.',
    },
  ]),
]);

// Serbia: every residence ground with work is tied to a job, own business or listed activity.

export const serbiaJobSeeker: MobilityScenarioDefinition = unavailableScenario(
  'job_seeker_visa',
  'Визы или ВНЖ для поиска работы в Сербии нет: виза D выдаётся, когда работа уже найдена, а единое разрешение оформляется с работодателем.',
  [sources.serbiaFindJob, sources.serbiaWork],
);

export const serbiaRemote: MobilityScenarioDefinition = unavailableScenario(
  'digital_nomad',
  'Отдельного ВНЖ для удалённой работы на зарубежную компанию в Сербии нет: для таких людей есть налоговые льготы, но не вид на жительство. Работать на себя можно по единому разрешению на основании самозанятости.',
  [sources.serbiaDigitalNomads, sources.serbiaWork],
);

// United Arab Emirates: visa-free entry for Russians, but no work on a visit.

export const uaeLocalWork: MobilityScenarioDefinition = scenario('simple_mobility', [
  path('uae-visa-free-entry-needs-work-permit', 'Безвизовый въезд не даёт права работать в ОАЭ', [
    {
      kind: 'work_authorization',
      source: sources.uaeWorkOnVisit,
      explanation:
        'Граждане России въезжают в ОАЭ без визы, но работать по гостевой или туристической визе запрещено — нужны разрешение на работу и рабочая виза.',
    },
  ]),
]);

// Germany: no residence permit for remote employees; freelancers have § 21(5) AufenthG.

export const germanyRemote: MobilityScenarioDefinition = scenario('digital_nomad', [
  path('germany-freelance-permit', 'Разрешение для свободной профессии (фриланс)', [
    {
      kind: 'manual_check',
      source: sources.germanFreelance,
      explanation:
        'Для удалённых сотрудников зарубежных компаний отдельного разрешения нет. Фрилансеру свободной профессии выдают ВНЖ до 3 лет; если для профессии нужен допуск, он должен быть получен; после 45 лет нужна достаточная пенсионная обеспеченность.',
    },
  ]),
]);

// United Kingdom: three routes without an employer; no remote-work visa.

export const ukJobSeeker: MobilityScenarioDefinition = scenario('job_seeker_visa', [
  path('high-potential-individual', 'High Potential Individual: выпускник университета из списка', [
    {
      kind: 'recent_top_university_graduate',
      amount: 5,
      source: sources.ukHighPotential,
      explanation:
        'Диплом университета из официального списка, полученный не более 5 лет назад; британские вузы не подходят.',
    },
    {
      kind: 'bachelor_degree',
      source: sources.ukHighPotential,
      explanation: 'Диплом уровня британского бакалавра, магистра или доктора.',
    },
    {
      kind: 'meets_language_requirements',
      source: sources.ukHighPotentialEnglish,
      explanation: 'Английский не ниже B2.',
    },
    {
      kind: 'minimum_savings',
      amount: 1_270,
      currency: 'GBP',
      source: sources.ukHighPotentialFunds,
      explanation: 'Не меньше £1 270 на счёте 28 дней подряд перед подачей.',
    },
  ]),
  path('graduate-visa', 'Graduate visa: после учёбы в Великобритании', [
    {
      kind: 'manual_check',
      source: sources.ukGraduate,
      explanation:
        'Подать можно, находясь в Великобритании по студенческой визе и окончив британскую программу; виза на 2 года при подаче до 31.12.2026, на 18 месяцев — с 01.01.2027.',
    },
  ]),
  path('global-talent', 'Global Talent: лидер в науке, искусстве или цифровых технологиях', [
    {
      kind: 'manual_check',
      source: sources.ukGlobalTalent,
      explanation: 'Нужна рекомендация уполномоченной организации или признанная премия.',
    },
  ]),
]);

export const ukRemote: MobilityScenarioDefinition = unavailableScenario(
  'digital_nomad',
  'Визы для жизни в Великобритании с удалённой работой нет: гостевая виза разрешает только перечисленные деловые поездки, для любой другой работы нужна рабочая виза.',
  [sources.ukVisitor],
);

export const ukLocalWork: MobilityScenarioDefinition = regionalScenario(
  'GB',
  ['IE'],
  sources.ukCommonTravelArea,
  'Общая зона передвижения для граждан Ирландии',
);

// Russia: work permit or patent, or the highly qualified specialist route.

export const russiaEmployer: MobilityScenarioDefinition = scenario('employer_sponsorship', [
  path('russia-highly-qualified-specialist', 'Высококвалифицированный специалист: общий порог', [
    {
      kind: 'job_offer',
      source: sources.russiaForeignWork,
      explanation: 'Нужен работодатель в России, который приглашает специалиста.',
    },
    {
      kind: 'minimum_offer_salary',
      amount: 750_000,
      currency: 'RUB',
      per: 'quarter',
      source: sources.russiaForeignWork,
      explanation: 'Зарплата не ниже 750 000 ₽ за квартал.',
    },
  ]),
  path(
    'russia-highly-qualified-specialist-it',
    'Высококвалифицированный специалист в аккредитованной ИТ-компании',
    [
      {
        kind: 'job_offer',
        source: sources.russiaForeignWork,
        explanation: 'Нужен оффер от ИТ-компании.',
      },
      {
        kind: 'manual_check',
        source: sources.russiaForeignWork,
        explanation:
          'Компания должна иметь государственную аккредитацию в области информационных технологий.',
      },
      {
        kind: 'minimum_offer_salary',
        amount: 83_500,
        currency: 'RUB',
        per: 'month',
        source: sources.russiaForeignWork,
        explanation: 'Зарплата не ниже 83 500 ₽ в месяц.',
      },
    ],
  ),
  path('russia-work-permit-or-patent', 'Разрешение на работу или патент', [
    {
      kind: 'job_offer',
      source: sources.russiaForeignWork,
      explanation:
        'Работать можно у работодателя, получившего разрешение на привлечение иностранных работников.',
    },
    {
      kind: 'manual_check',
      source: sources.russiaForeignWork,
      explanation: 'Нужно разрешение на работу или патент; граждан ЕАЭС это не касается.',
    },
  ]),
]);

export const russiaJobSeeker: MobilityScenarioDefinition = unavailableScenario(
  'job_seeker_visa',
  'Визы для поиска работы в России нет: обыкновенные визы бывают частными, деловыми, туристическими, учебными, рабочими, гуманитарными и для убежища или временного проживания.',
  [sources.russiaVisaTypes],
);

export const russiaRemote: MobilityScenarioDefinition = unavailableScenario(
  'digital_nomad',
  'Визы или ВНЖ для удалённой работы на зарубежную компанию в России нет: закон не предусматривает такой цели въезда.',
  [sources.russiaVisaTypes],
);
