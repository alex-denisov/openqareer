import type { Page, Route } from '@playwright/test';

/** Карточка из макета v04: Ладога Банк, «Руководитель разработки», 480–580 тыс. ₽. */
export const LADOGA_ID = 'ladoga-1';
const OBSERVED = '2026-11-11T09:00:00.000Z';

const ITEM = {
  cluster: {
    id: LADOGA_ID,
    canonicalTitle: 'Руководитель разработки',
    canonicalCompany: 'Ладога Банк',
    canonicalLocation: 'Москва',
    isRemote: false,
    workFormat: 'hybrid',
    salary: { from: 480_000, to: 580_000, currency: 'RUR' },
    descriptionSummary: 'Команда платежей, 40 человек.',
    skills: ['Go', 'PostgreSQL'],
    primaryUrl: 'https://hh.ru/vacancy/101',
    sources: [
      {
        sourceType: 'json_api',
        sourceId: 'hh',
        sourceName: 'hh.ru',
        sourceUrl: 'https://hh.ru/vacancy/101',
        observedAt: OBSERVED,
      },
    ],
    firstObservedAt: OBSERVED,
    lastSeenAt: OBSERVED,
    status: 'active',
    vacanciesCount: 3,
    companyFeatures: { industry: 'Банки', city: 'Москва' },
  },
  explanation: {
    clusterId: LADOGA_ID,
    roleMatch: 'target',
    requirements: { matched: 6, total: 7 },
    matchingPoints: ['Go'],
    missingPoints: [],
    matchingCount: 6,
    missingCount: 1,
    summary: 'Роль совпадает с целевой.',
    calculatedAt: OBSERVED,
    marketSalary: {
      low: 380_000,
      high: 520_000,
      currency: 'RUR',
      period: 'month',
      tax: 'unknown',
      computedAt: '2026-11-10T03:00:00.000Z',
    },
  },
};

const person = (
  id: string,
  circle: number,
  name: string | null,
  roleTitle: string,
  evidence: string | null,
) => ({
  id,
  circle,
  name,
  roleTitle,
  evidence,
  nextStep: circle === 1 ? 'write_known_contact' : 'ask_for_introduction',
  vacancyId: LADOGA_ID,
  platformMember: name === null,
  message:
    name === null
      ? null
      : {
          kind: circle === 1 ? 'known_contact' : 'ask_introduction',
          target: { contactId: `c-${id}` },
        },
});

const PEOPLE = [
  person(
    'p1',
    1,
    'Роман Ефимов',
    'руководитель группы платежей',
    'ваша связь в LinkedIn, работали вместе в «Сфере Платежи»',
  ),
  person('p2', 2, 'Наталья Седова', 'директор по разработке', 'через Романа Ефимова'),
  person('p3', 2, null, 'руководитель платформы', 'через участника openqareer, нужно его согласие'),
];

const json = (route: Route, data: unknown) => route.fulfill({ json: { data, meta: {} } });

const QUESTIONS = ['Опыт найма', 'Размер команды', 'Ожидания по доходу'].map((text, index) => ({
  id: `q${index}`,
  text,
  required: true,
  kind: 'text',
}));

export interface LadogaOptions {
  /** Знакомых в компании нет: остаются hh.ru и сайт. */
  readonly noPeople?: boolean;
}

/** Данные карточки Ладоги поверх общей заглушки кабинета: вызывать после `mockSignedInCabinet`. */
export async function mockLadoga(page: Page, options: LadogaOptions = {}): Promise<void> {
  const people = options.noPeople ? [] : PEOPLE;
  await page.route(`**/api/v1/candidate/b640/vacancies/${LADOGA_ID}`, (route) => json(route, ITEM));
  await page.route(/\/api\/v1\/candidate\/b640\/companies\/[^/?]+\/people/u, (route) =>
    json(route, { items: people, total: people.length, offset: 0, nextOffset: null }),
  );
  await page.route(/\/api\/v1\/candidate\/b640\/companies\/[^/?]+(\?|$)/u, (route) =>
    json(route, {
      company: {
        key: 'k',
        name: 'Ладога Банк',
        location: 'Москва',
        industry: 'Банки · частный банк, платёжные сервисы для малого бизнеса, 2 500 сотрудников',
        vacancyCount: 3,
        want: false,
        vacancies: [],
        recruiters: [],
        sources: [{ name: 'hh.ru', observedAt: '2026-11-10T09:00:00.000Z' }],
      },
      roleVacancies: [],
      roleTotal: 0,
      roleNextOffset: null,
      otherVacancies: [],
      otherTotal: 0,
      applications: {},
    }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/questionnaire', (route) =>
    json(route, {
      vacancyId: LADOGA_ID,
      state: 'ready',
      formUrl: 'https://ladogabank.example/form',
      questions: QUESTIONS,
      answers: [],
      suggestions: [],
      answered: 0,
    }),
  );
  await page.route('**/api/v1/candidate/decision-profile', (route) =>
    json(route, {
      citizenship: [],
      languages: [],
      workFormats: [],
      salaryFloor: 500_000,
      salaryCurrency: 'RUB',
    }),
  );
  await page.route('**/api/v1/candidate/hh/resumes/review*', (route) =>
    json(route, {
      requirements: [],
      resumes: [
        {
          resumeId: 'r1',
          title: 'Руководитель разработки',
          status: 'fits',
          matched: [],
          missing: [],
        },
      ],
      recommendedId: 'r1',
    }),
  );
  await page.route('**/api/v1/candidate/hh/resumes*', (route) =>
    json(route, {
      resumes: [],
      selected: { id: 'r1', title: 'Руководитель разработки', text: '' },
      readAt: OBSERVED,
    }),
  );
  await page.route('**/api/v1/vacancies/*/contacts', (route) =>
    json(route, {
      contacts: [
        {
          id: 'c1',
          vacancyId: LADOGA_ID,
          companyName: 'Ладога Банк',
          fullName: 'Алина Громова',
          roleTitle: 'технический рекрутер',
        },
      ],
      job: null,
    }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/connection-circles', (route) =>
    json(route, {
      vacancyId: LADOGA_ID,
      companyKey: 'k',
      companyName: 'Ладога Банк',
      vacancyTitle: 'Руководитель разработки',
      circles: [],
      resume: { available: true, kind: 'targeted' },
      linkedinImport: { state: 'imported', importedAt: null, importedCount: null },
    }),
  );
  await page.route('**/api/v1/candidate/b640/contact-messages', (route) => json(route, DRAFT));
}

/** Черновик Роману (a02d): текст макета. */
export const DRAFT = {
  id: 'm1',
  kind: 'known_contact',
  text: 'Роман, добрый день! Мы работали вместе в «Сфере Платежи». Вижу у Ладога Банка вакансию «Руководитель разработки» — подскажете, кто её ведёт и удобно ли передать моё резюме?',
  recipient: { name: 'Роман Ефимов', linkedinUrl: null },
  createdAt: '2026-11-12T12:03:00.000Z',
};

const req = (id: string, text: string) => ({
  id,
  text,
  sourceQuote: text,
  origin: 'explicit',
  importance: 'high',
  kind: 'experience',
  hard: false,
  stopFactor: false,
  skill: true,
});

const TEXTS = [
  'Команда от 8 человек',
  'Go и PostgreSQL',
  'Kubernetes',
  'Процесс релизов',
  'Платёжные системы',
  'Найм в команду',
  'Найм руководителей',
];

/** Совпадение 86 %: 6 требований из 7, седьмое частично. */
export const LADOGA_FIT = {
  state: 'ready',
  requirements: TEXTS.map((text, index) => req(`r${index}`, text)),
  result: {
    candidateId: 'c',
    vacancyId: LADOGA_ID,
    algorithmVersion: 'evidence-coverage-9',
    status: 'assessed',
    calculatedAt: '2026-11-11T09:00:00Z',
    dataState: 'confirmed',
    coveragePercent: 86,
    requiredCoverage: { matched: 6, total: 7, percent: 86 },
    coverage: { matched: 6, total: 7, unknown: 0, partial: 1 },
    reason: 'assessed',
    gates: {},
    assessments: TEXTS.map((_, index) => ({
      requirementId: `r${index}`,
      status: index < 6 ? 'matched' : 'partial',
      evidence: [{ factId: `f${index}`, quote: 'Финтех Лаб' }],
    })),
  },
};
