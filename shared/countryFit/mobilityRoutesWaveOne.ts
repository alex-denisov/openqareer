/**
 * Wave 1 routes checked against official pages on 2026-10-26 (see the PR table «страна × путь»).
 * A pair is a verified set of paths, an `unavailable` answer with its source, or `no_data`
 * where the official page could not be read.
 */
import { sources } from './mobilitySources';
import { path, scenario, unavailableScenario } from './mobilityScenarioBuilders';
import type { MobilityRequirement, MobilityScenarioDefinition } from './types';

/** Visa-free entry is not a right to work: local work needs a permit in the country. */
function permitRequiredScenario(
  countryCode: string,
  explanation: string,
  evidence: (typeof sources)[keyof typeof sources],
): MobilityScenarioDefinition {
  return scenario('simple_mobility', [
    path(
      `${countryCode.toLowerCase()}-visa-free-entry-needs-work-permit`,
      'Безвизовый въезд не даёт права работать',
      [{ kind: 'work_authorization', source: evidence, explanation }],
    ),
  ]);
}

// Armenia: employer-led residence for work; EAEU citizens need no permit.

export const armeniaEmployer: MobilityScenarioDefinition = scenario('employer_sponsorship', [
  path('armenia-work-based-residence', 'ВНЖ по работе через армянского работодателя', [
    {
      kind: 'job_offer',
      source: sources.armeniaWorkPermit,
      explanation: 'Запрос на ВНЖ по работе подаёт работодатель через систему workpermit.am.',
    },
    {
      kind: 'manual_check',
      source: sources.armeniaWorkPermit,
      explanation: 'Найм иностранца на вакансию подтверждает Министерство труда и социальных дел.',
    },
  ]),
]);

export const armeniaJobSeeker: MobilityScenarioDefinition = unavailableScenario(
  'job_seeker_visa',
  'Отдельного ВНЖ для поиска работы в Армении нет: основания — учёба, предпринимательство, армянское происхождение, семья, разрешение на работу и волонтёрство.',
  [sources.armeniaResidenceGrounds],
);

export const armeniaRemote: MobilityScenarioDefinition = scenario('digital_nomad', [
  path(
    'armenia-visa-free-remote-work',
    'Безвизовое пребывание и удалённая работа на зарубежную компанию',
    [
      {
        kind: 'visa_free_stay',
        eligibleCitizenshipCountryCodes: ['RU'],
        maximumStayDays: 180,
        source: sources.armeniaVisaFreeList,
        explanation: 'Граждане России въезжают в Армению без визы.',
      },
      {
        kind: 'manual_check',
        source: sources.armeniaVisaFreeStay,
        explanation:
          'Без визы можно находиться не более 180 дней в году. Отдельной визы или ВНЖ для удалённой работы нет: для более долгого пребывания нужен ВНЖ по другому основанию.',
      },
    ],
  ),
]);

// Kazakhstan: employer permit, a self-employment certificate for listed professions, Neo Nomad visa.

const kazakhstanEntryConditions: MobilityRequirement = {
  kind: 'completed_qualification',
  source: sources.kazakhstanMigration,
  explanation:
    'Нужны образование, квалификация и опыт для предстоящей работы, справка о несудимости и медстраховка.',
};

export const kazakhstanEmployer: MobilityScenarioDefinition = scenario('employer_sponsorship', [
  path(
    'kazakhstan-employer-permit',
    'Разрешение работодателю на привлечение иностранного работника',
    [
      {
        kind: 'job_offer',
        source: sources.kazakhstanMigration,
        explanation:
          'Виза и временное проживание выдаются на срок разрешения, полученного работодателем.',
      },
      kazakhstanEntryConditions,
    ],
  ),
]);

export const kazakhstanJobSeeker: MobilityScenarioDefinition = scenario('job_seeker_visa', [
  path('kazakhstan-self-employment-certificate', 'Справка для самостоятельного трудоустройства', [
    {
      kind: 'occupation_eligible',
      source: sources.kazakhstanMigration,
      explanation:
        'Справка выдаётся по профессиям из перечня востребованных в приоритетных отраслях; с ней можно искать работу самому.',
    },
    kazakhstanEntryConditions,
  ]),
]);

export const kazakhstanRemote: MobilityScenarioDefinition = scenario('digital_nomad', [
  path('kazakhstan-neo-nomad-visa', 'Виза Neo Nomad для удалённой работы', [
    {
      kind: 'minimum_remote_income',
      amount: 3_000,
      currency: 'USD',
      incomeBasis: 'unspecified',
      source: sources.kazakhstanNeoNomad,
      explanation: 'Постоянный доход из зарубежных источников не меньше $3 000 в месяц.',
    },
    {
      kind: 'foreign_remote_employment',
      source: sources.kazakhstanNeoNomad,
      explanation: 'Виза для удалённой работы; работать по найму в Казахстане по ней нельзя.',
    },
  ]),
]);

// Türkiye: work permit via the employer; no job-search residence; digital nomad visa.

export const turkeyEmployer: MobilityScenarioDefinition = scenario('employer_sponsorship', [
  path('turkey-work-permit', 'Разрешение на работу по предложению работодателя', [
    {
      kind: 'job_offer',
      source: sources.turkeyLabour,
      explanation:
        'Работать без разрешения нельзя; заявление подают в министерство или через консульство.',
    },
    {
      kind: 'manual_check',
      source: sources.turkeyLabour,
      explanation:
        'Заявление оценивается по государственной политике в отношении иностранной рабочей силы.',
    },
  ]),
]);

export const turkeyJobSeeker: MobilityScenarioDefinition = unavailableScenario(
  'job_seeker_visa',
  'Отдельного ВНЖ для поиска работы в Турции нет: закон перечисляет краткосрочный, семейный, студенческий, долгосрочный и гуманитарный ВНЖ, и ни один не выдаётся для поиска работы.',
  [sources.turkeyResidence],
);

export const turkeyRemote: MobilityScenarioDefinition = scenario('digital_nomad', [
  path('turkey-digital-nomad-visa', 'Виза цифрового кочевника', [
    {
      kind: 'bachelor_degree',
      source: sources.turkeyNomadDiploma,
      explanation: 'Нужен диплом о высшем образовании.',
    },
    {
      kind: 'foreign_remote_employment',
      source: sources.turkeyNomadNationalities,
      explanation: 'Нужен договор с компанией или письмо о проекте, если вы работаете на себя.',
    },
    {
      kind: 'private_health_insurance',
      source: sources.turkeyNomadNationalities,
      explanation: 'Медицинская страховка на весь срок с покрытием не меньше 30 000 €.',
    },
    {
      kind: 'manual_check',
      source: sources.turkeyNomadNationalities,
      explanation:
        'Сначала нужен сертификат Министерства культуры и туризма на digitalnomads.goturkiye.com; виза доступна гражданам из списка, Россия в нём есть.',
    },
  ]),
]);

export const turkeyLocalWork = permitRequiredScenario(
  'TR',
  'Безвизовый въезд не даёт права работать: работать в Турции можно только по разрешению на работу.',
  sources.turkeyLabour,
);

// Uzbekistan: the employer obtains a work-right confirmation.

export const uzbekistanEmployer: MobilityScenarioDefinition = scenario('employer_sponsorship', [
  path(
    'uzbekistan-work-right-confirmation',
    'Подтверждение права на трудовую деятельность через работодателя',
    [
      {
        kind: 'job_offer',
        source: sources.uzbekistanEmployment,
        explanation:
          'Подтверждение для иностранного работника получает работодатель в Агентстве миграции.',
      },
    ],
  ),
]);

export const uzbekistanJobSeeker: MobilityScenarioDefinition = unavailableScenario(
  'job_seeker_visa',
  'Визы для поиска работы в Узбекистане нет: рабочая виза E выдаётся только по разрешению на трудовую деятельность, которое оформляет работодатель.',
  [sources.uzbekistanVisaCategories, sources.uzbekistanEmployment],
);

export const uzbekistanRemote: MobilityScenarioDefinition = scenario('digital_nomad', [
  path('uzbekistan-it-visa', 'IT-виза для специалистов в сфере ИТ', [
    {
      kind: 'it_professional',
      source: sources.uzbekistanVisaCategories,
      explanation:
        'IT-виза до трёх лет выдаётся специалистам в сфере ИТ, инвесторам и учредителям резидентов IT-парка.',
    },
    {
      kind: 'manual_check',
      source: sources.uzbekistanVisaCategories,
      explanation:
        'Нужна рекомендация дирекции IT-парка. Отдельной визы для удалённой работы нет; граждане России въезжают без визы без ограничения срока.',
    },
  ]),
]);

export const uzbekistanLocalWork = permitRequiredScenario(
  'UZ',
  'Иностранец может работать по найму только при подтверждении права на трудовую деятельность, полученном работодателем.',
  sources.uzbekistanEmployment,
);

// Belarus: a special permit for the employer; EAEU citizens work without it.

export const belarusEmployer: MobilityScenarioDefinition = scenario('employer_sponsorship', [
  path('belarus-special-permit', 'Специальное разрешение нанимателю', [
    {
      kind: 'job_offer',
      source: sources.belarusLabourMigration,
      explanation:
        'Работать можно только по трудовому договору и специальному разрешению, которое получает наниматель.',
    },
    {
      kind: 'manual_check',
      source: sources.belarusLabourMigration,
      explanation:
        'Разрешение выдают с учётом заключения областного комитета по труду, если вакансию не могут занять граждане и постоянно проживающие.',
    },
  ]),
]);

export const belarusJobSeeker: MobilityScenarioDefinition = unavailableScenario(
  'job_seeker_visa',
  'Визы для поиска работы в Беларуси нет: виза «работа» выдаётся только по специальному разрешению нанимателя. Граждане ЕАЭС работают без разрешения.',
  [sources.belarusVisaRules, sources.belarusLabourMigration],
);

export const belarusRemote: MobilityScenarioDefinition = unavailableScenario(
  'digital_nomad',
  'Отдельной визы или статуса для удалённой работы в Беларуси нет: категории виз — служебные, деловые, учёба, работа, туризм, частные дела и другие. Граждане ЕАЭС живут и работают по праву ЕАЭС.',
  [sources.belarusVisaRules],
);

// Montenegro: temporary stay and work permit with an employer's written offer; digital nomad visa D.

export const montenegroEmployer: MobilityScenarioDefinition = scenario('employer_sponsorship', [
  path('montenegro-stay-and-work-permit', 'Разрешение на временное проживание и работу', [
    {
      kind: 'job_offer',
      source: sources.montenegroWorkPermit,
      explanation: 'Нужно письменное предложение работодателя на конкретную должность.',
    },
    {
      kind: 'completed_qualification',
      source: sources.montenegroWorkPermit,
      explanation: 'Нужны документы об образовании и квалификации.',
    },
    {
      kind: 'private_health_insurance',
      source: sources.montenegroWorkPermit,
      explanation: 'Нужна медицинская страховка.',
    },
    {
      kind: 'manual_check',
      source: sources.montenegroWorkPermit,
      explanation: 'Также проверяются средства на проживание и жильё.',
    },
  ]),
]);

export const montenegroJobSeeker: MobilityScenarioDefinition = scenario('job_seeker_visa', [
  path(
    'montenegro-job-search-after-study',
    'ВНЖ на 9 месяцев для поиска работы после учёбы или исследований в Черногории',
    [
      {
        kind: 'manual_check',
        source: sources.montenegroForeigners,
        explanation:
          'Общего ВНЖ для поиска работы нет. После окончания учёбы или исследований в Черногории можно получить ВНЖ на 9 месяцев для поиска работы.',
      },
    ],
  ),
]);

export const montenegroRemote: MobilityScenarioDefinition = scenario('digital_nomad', [
  path('montenegro-digital-nomad', 'ВНЖ цифрового кочевника на срок до двух лет', [
    {
      kind: 'foreign_remote_employment',
      source: sources.montenegroForeigners2026,
      explanation:
        'Нужен договор или документ о работе в электронном виде на зарубежную компанию или свою компанию, зарегистрированную в другой стране.',
    },
    {
      kind: 'private_health_insurance',
      source: sources.montenegroForeigners2026,
      explanation: 'Нужна медицинская страховка.',
    },
    {
      kind: 'manual_check',
      source: sources.montenegroForeigners2026,
      explanation:
        'Также проверяются средства на проживание и жильё; размер средств закон не называет. ВНЖ выдаётся до двух лет и продлевается ещё на два.',
    },
  ]),
]);

export const montenegroLocalWork = permitRequiredScenario(
  'ME',
  'Безвизовый въезд не даёт права работать: работать в Черногории можно только на должности, на которую выдано разрешение.',
  sources.montenegroWorkPermit,
);
