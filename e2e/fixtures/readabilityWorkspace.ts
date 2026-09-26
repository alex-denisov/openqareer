/**
 * B232. Кабинет с настоящим объёмом текста: резюме на три позиции, целевая
 * роль, три рынка и подбор из 96 записей. Замер читаемости на пустом кабинете
 * ничего не доказывает — россыпь кеглей живёт в досье, карточках и таблице.
 */

export const candidate = {
  username: 'qa-readability',
  email: 'qa-readability@example.com',
  displayName: 'Мария Соколова',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-b232',
};

export const account = {
  username: candidate.username,
  email: candidate.email,
  displayName: candidate.displayName,
  profile: {
    headline: 'Руководитель продукта, финтех',
    location: 'Москва',
    workMode: 'remote',
    updatedAt: '2026-09-18T10:00:00.000Z',
  },
  sessions: [
    {
      id: 'session-current',
      current: true,
      createdAt: '2026-09-18T10:00:00.000Z',
      lastSeenAt: '2026-09-20T10:00:00.000Z',
      expiresAt: '2026-10-20T10:00:00.000Z',
    },
  ],
};

export const workspace = {
  careerGoal: 'find-job',
  resumeSource: 'text',
  resumeText: [
    'Мария Соколова',
    'Руководитель продукта, финтех и маркетплейсы',
    'Москва · удалённо · английский C1',
    '',
    'Опыт',
    'Руководитель продукта, FinCloud — 2022–2026',
    'Вела платёжный продукт для малого бизнеса: 1,2 млн активных клиентов, рост выручки на 38 % за год.',
    'Запустила онбординг за 4 минуты вместо 20, конверсия в первую операцию выросла с 31 до 52 %.',
    'Команда из 14 человек: разработка, аналитика, дизайн, поддержка.',
    '',
    'Старший продуктовый менеджер, Ozon — 2019–2022',
    'Отвечала за витрину поиска и рекомендаций: A/B-платформа, 60 экспериментов в квартал.',
    'Вывела релевантность поиска в топ-3 метрик компании; NPS раздела вырос на 11 пунктов.',
    '',
    'Продуктовый аналитик, Яндекс — 2016–2019',
    'Строила модели удержания и юнит-экономику для сервиса доставки.',
    '',
    'Навыки',
    'Product discovery, JTBD, юнит-экономика, SQL, Python, A/B-тестирование, Figma, Jira, английский C1, управление командой, roadmap, OKR',
    '',
    'Образование',
    'НИУ ВШЭ, магистр экономики, 2016',
  ].join('\n'),
  targetDirection: 'Head of Product / Product Lead в финтехе',
  regions: ['ru', 'eu', 'mena'],
  currentSituation:
    'Работаю, но продукт вошёл в стадию поддержки; хочу перейти на уровень выше в компанию с международным рынком.',
  constraints: 'Только удалённо или гибрид; готова к релокации в EU или ОАЭ.',
  urgency: 'active',
  linkedinUrl: 'https://www.linkedin.com/in/maria-sokolova-example',
};

const companies = ['FinCloud', 'Revolut', 'Wise', 'Tabby', 'Ozon', 'Tinkoff', 'Klarna', 'Yango'];
const titles = [
  'Head of Product, Payments',
  'Product Lead, Merchant Onboarding',
  'Senior Product Manager, Lending Platform',
  'Руководитель продукта, платёжный сервис для бизнеса',
  'Group Product Manager, Growth and Retention',
  'Директор по продукту, финтех-маркетплейс',
];
const locations = ['Москва', 'Berlin', 'Dubai', 'Amsterdam', 'Санкт-Петербург', 'London'];
const sources = [
  { sourceType: 'json_api', sourceId: 'hh', sourceName: 'hh.ru' },
  { sourceType: 'jobspy', sourceId: 'linkedin', sourceName: 'LinkedIn' },
  { sourceType: 'rss', sourceId: 'himalayas', sourceName: 'Himalayas' },
];

export const matchedVacancies = Array.from({ length: 96 }, (_, index) => {
  const source = sources[index % sources.length];
  const observedAt = new Date(Date.UTC(2026, 8, 20 - (index % 12), 9, 0, 0)).toISOString();
  return {
    cluster: {
      id: `cluster-${index}`,
      canonicalTitle: titles[index % titles.length],
      canonicalCompany: companies[index % companies.length],
      canonicalLocation: index % 5 === 0 ? undefined : locations[index % locations.length],
      isRemote: index % 5 === 0,
      salary:
        index % 3 === 0
          ? { from: 350_000 + index * 1_000, to: 520_000 + index * 1_000, currency: '₽' }
          : undefined,
      descriptionSummary:
        'Отвечать за платёжный продукт, метрики роста и команду из восьми человек.',
      skills: ['Product discovery', 'SQL', 'A/B-тестирование', 'Юнит-экономика'],
      primaryUrl: `https://example.test/vacancy/${index}`,
      sources: [
        {
          ...source,
          sourceUrl: `https://example.test/vacancy/${index}`,
          observedAt,
        },
      ],
      firstObservedAt: observedAt,
      lastSeenAt: observedAt,
      status: 'active',
      vacanciesCount: 1 + (index % 3),
      companyFeatures: index % 4 === 0 ? { remoteFriendly: true } : undefined,
    },
    explanation: {
      clusterId: `cluster-${index}`,
      roleMatch: index % 2 === 0 ? 'target' : 'adjacent',
      requirements: index % 7 === 0 ? undefined : { matched: 3 + (index % 4), total: 7 },
      matchingPoints: ['Product discovery', 'SQL'],
      missingPoints: ['Kotlin'],
      matchingCount: 3 + (index % 4),
      missingCount: 1,
      summary: 'Роль совпадает с целевой, покрытие требований выше среднего по подбору.',
      calculatedAt: observedAt,
    },
  };
});

/** Подбор едет страницами по 50 (INC-029, B211). */
export function matchedVacancyPage(offset: number) {
  const pageSize = 50;
  const items = matchedVacancies.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize < matchedVacancies.length ? offset + pageSize : null;
  return {
    data: items,
    meta: {
      total: matchedVacancies.length,
      nextOffset,
      ...(offset === 0 ? { pageOffsets: [0, 50] } : {}),
    },
  };
}

const memoryAt = '2026-09-18T10:00:00.000Z';

function memory(
  id: string,
  domain: string,
  statement: string,
  status: 'confirmed' | 'proposed' = 'confirmed',
) {
  return {
    id,
    kind: 'fact',
    domain,
    statement,
    confidence: status === 'confirmed' ? 'candidate-confirmed' : 'candidate-reported',
    sourceMessageIds: [],
    sensitive: false,
    status,
    createdAt: memoryAt,
    updatedAt: memoryAt,
  };
}

export const candidateMemory = [
  memory(
    'm-resp-1',
    'responsibility',
    'Вела платёжный продукт FinCloud для малого бизнеса: 1,2 млн активных клиентов.',
  ),
  memory(
    'm-resp-2',
    'responsibility',
    'Отвечала за витрину поиска и рекомендаций Ozon: A/B-платформа, 60 экспериментов в квартал.',
  ),
  memory('m-out-1', 'outcome', 'Рост выручки платёжного продукта на 38 % за год.'),
  memory(
    'm-out-2',
    'outcome',
    'Онбординг за 4 минуты вместо 20; конверсия в первую операцию с 31 до 52 %.',
  ),
  memory('m-out-3', 'outcome', 'NPS раздела поиска Ozon вырос на 11 пунктов.', 'proposed'),
  memory('m-skill-1', 'skill', 'Product discovery и JTBD-интервью'),
  memory('m-skill-2', 'skill', 'SQL и Python для продуктовой аналитики'),
  memory('m-skill-3', 'skill', 'A/B-тестирование и юнит-экономика'),
  memory('m-skill-4', 'skill', 'Управление командой из 14 человек'),
  memory('m-edu-1', 'role-evidence', 'НИУ ВШЭ, магистр экономики, 2016'),
  memory('m-lang-1', 'role-evidence', 'Английский C1'),
  memory('m-pref-1', 'preference', 'Удалённо или гибрид; готова к релокации в EU или ОАЭ.'),
  memory('m-gap-1', 'gap', 'Нет опыта вывода продукта на рынок MENA.', 'proposed'),
];

export const candidateSnapshot = {
  importedSources: [
    { platform: 'linkedin', connectedAt: memoryAt, lastImportedAt: memoryAt, factCount: 11 },
  ],
  candidate: {
    id: candidate.candidateId,
    dataClass: 'personal',
    locale: 'ru-RU',
    createdAt: memoryAt,
  },
  messages: [],
  memory: candidateMemory,
  turns: [],
  dossier: {
    sections: [
      {
        domain: 'responsibility',
        items: candidateMemory.filter((m) => m.domain === 'responsibility'),
      },
      { domain: 'outcome', items: candidateMemory.filter((m) => m.domain === 'outcome') },
      { domain: 'skill', items: candidateMemory.filter((m) => m.domain === 'skill') },
    ].map((section) => ({
      domain: section.domain,
      items: section.items.map((item) => ({
        memoryId: item.id,
        statement: item.statement,
        status: item.status,
        sourceMessageIds: [],
        sensitive: false,
      })),
    })),
    confirmedCount: candidateMemory.filter((m) => m.status === 'confirmed').length,
    proposedCount: candidateMemory.filter((m) => m.status === 'proposed').length,
    readiness: {
      complete: false,
      unresolvedQuestions: 2,
      checks: [
        { id: 'experience', complete: true, evidenceCount: 2 },
        { id: 'impact', complete: true, evidenceCount: 3 },
        { id: 'capability', complete: true, evidenceCount: 4 },
        { id: 'direction', complete: true, evidenceCount: 1 },
        { id: 'unknowns', complete: false, evidenceCount: 2 },
      ],
    },
  },
  assessments: [],
  germanyMarket: null,
  resume: {
    draft: {
      candidate: {
        fullName: 'Мария Соколова',
        about: 'Руководитель продукта в финтехе: платежи, онбординг, рост выручки.',
        contact: {
          location: 'Москва',
          links: ['https://www.linkedin.com/in/maria-sokolova-example'],
        },
      },
      targetRole: 'Head of Product',
      experience: [
        {
          id: 'exp-1',
          chronologyMemoryId: 'm-resp-1',
          title: 'Руководитель продукта',
          employer: 'FinCloud',
          location: 'Москва',
          startDate: '2022-03',
          current: true,
          bulletMemoryIds: ['m-out-1', 'm-out-2'],
        },
        {
          id: 'exp-2',
          chronologyMemoryId: 'm-resp-2',
          title: 'Старший продуктовый менеджер',
          employer: 'Ozon',
          location: 'Москва',
          startDate: '2019-01',
          endDate: '2022-02',
          current: false,
          bulletMemoryIds: ['m-out-3'],
        },
        {
          id: 'exp-3',
          chronologyMemoryId: 'm-resp-2',
          title: 'Продуктовый аналитик',
          employer: 'Яндекс',
          startDate: '2016-09',
          endDate: '2018-12',
          current: false,
          bulletMemoryIds: [],
        },
      ],
      skills: [
        { id: 'sk-1', evidenceMemoryId: 'm-skill-1', name: 'Product discovery' },
        { id: 'sk-2', evidenceMemoryId: 'm-skill-2', name: 'SQL' },
        { id: 'sk-3', evidenceMemoryId: 'm-skill-3', name: 'A/B-тестирование' },
        { id: 'sk-4', evidenceMemoryId: 'm-skill-4', name: 'Управление командой' },
      ],
      education: [
        {
          id: 'edu-1',
          evidenceMemoryId: 'm-edu-1',
          institution: 'НИУ ВШЭ',
          qualification: 'Магистр экономики',
          endDate: '2016',
        },
      ],
      languages: [{ id: 'lang-1', evidenceMemoryId: 'm-lang-1', name: 'Английский', cefr: 'C1' }],
    },
    createdAt: memoryAt,
    updatedAt: memoryAt,
  },
  documents: [],
  vacancySubscriptions: [],
};

/** B248/today.html — the «Сегодня» screen's own digest and queue, needed
 * once it replaced the old CareerHome as the default landing surface. */
export const todaySnapshot = {
  digest: {
    waitingForYou: 3,
    newVacancies: 9,
    followUpsDueToday: 2,
    closedVacancies: 1,
    interviewsAhead: 1,
    nextInterview: {
      company: 'FinCloud',
      title: 'Head of Product, повторное интервью',
      round: 2,
      at: '2026-09-27T14:00:00.000Z',
    },
    newVacanciesCaption: {
      campaignRole: 'Head of Product, Payments',
      sourcesCount: 3,
      updatedAt: '2026-09-23T09:14:00.000Z',
    },
    followUpCaptions: ['Ozon — 5 рабочих дней тишины'],
  },
  queue: [
    {
      kind: 'follow_up',
      applicationId: 'app-b232-1',
      title: 'Head of Product, Payments',
      company: 'Ozon',
      eyebrow: 'Follow-up · 5 рабочих дней без ответа',
      dueAt: '2026-09-23T00:00:00.000Z',
      salary: { from: 420000, currency: 'rub' },
      fit: null,
    },
    {
      kind: 'new_vacancy',
      clusterId: 'cl-b232-1',
      title: 'Group Product Manager, Growth',
      company: 'Wildberries',
      eyebrow: 'Новая вакансия · сегодня',
      dueAt: null,
      salary: { from: 380000, to: 480000, currency: 'rub' },
      location: 'Москва · гибрид',
      fit: { role: 'target', level: 'target', geo: true },
    },
    {
      kind: 'interview',
      applicationId: 'app-b232-2',
      title: 'Head of Product, повторное интервью',
      company: 'FinCloud',
      eyebrow: 'Интервью через 4 дня',
      dueAt: '2026-09-27T14:00:00.000Z',
      fit: null,
    },
  ],
  followUps: [
    {
      applicationId: 'app-b232-1',
      company: 'Ozon',
      title: 'Head of Product, Payments',
      status: 'today',
    },
  ],
  sinceLastVisit: {
    since: '2026-09-23T08:00:00.000Z',
    items: ['9 новых вакансий по Head of Product, Payments', 'FinCloud подтвердил второй раунд'],
  },
  vacanciesPending: true,
};

export const roleHypotheses = [
  {
    id: 'role-1',
    title: 'Head of Product, Payments',
    origin: 'model',
    reason:
      'Платёжный продукт, рост выручки и команда из 14 человек — прямое совпадение с целевой ролью.',
    evidenceRefs: ['m-resp-1', 'm-out-1'],
    confirmation: { state: 'too-few', sampleSize: 4 },
    family: 'product',
  },
  {
    id: 'role-2',
    title: 'Group Product Manager, Growth',
    origin: 'market',
    reason: 'Онбординг и конверсия — опыт роста, который ищут в growth-ролях.',
    evidenceRefs: ['m-out-2'],
    confirmation: { state: 'not-found' },
    family: 'product',
  },
];
