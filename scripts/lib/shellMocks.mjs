/**
 * Onboarding API mocks shared between `verify-built-shell.mjs` and
 * `capture-onboarding-shots.mjs` (B249). One realistic candidate — six jobs,
 * education, skills and result numbers — so both the built-shell walk and the
 * screenshot capture see the same data the mockup describes
 * (docs/v1-release/tasks/work/B248/onboarding.html).
 */

const JSON_HEADERS = { status: 200, contentType: 'application/json' };

function json(data, extra) {
  return { ...JSON_HEADERS, ...extra, body: JSON.stringify({ data }) };
}

/** Six roles, newest first, each with a numbered achievement. */
const ONBOARDING_EXPERIENCE = [
  {
    title: 'Продуктовый аналитик',
    employer: 'Даниленко Групп',
    location: 'Дубай, ОАЭ',
    startDate: '2024-02',
    current: true,
    responsibilities: ['Аналитика воронки доставки'],
    achievements: ['+18% конверсия за 2 квартала'],
  },
  {
    title: 'Продуктовый аналитик',
    employer: 'Skyline Retail',
    location: 'Дубай, ОАЭ',
    startDate: '2022-05',
    endDate: '2024-01',
    current: false,
    responsibilities: ['Дашборды для 6 команд'],
    achievements: ['Решения: 5 дней → 1 день'],
  },
  {
    title: 'Аналитик данных',
    employer: 'Северный Мост',
    location: 'Москва',
    startDate: '2020-09',
    endDate: '2022-04',
    current: false,
    responsibilities: ['Отчётность по 12 каналам'],
    achievements: ['Нашли утечку 9 млн ₽/год'],
  },
  {
    title: 'Младший аналитик',
    employer: 'Ритейл Синергия',
    location: 'Москва',
    startDate: '2019-01',
    endDate: '2020-08',
    current: false,
    responsibilities: ['Еженедельные отчёты продаж'],
    achievements: ['Сэкономили 10 ч/неделю'],
  },
  {
    title: 'Стажёр-аналитик',
    employer: 'Инсайт Диджитал',
    location: 'Москва',
    startDate: '2018-06',
    endDate: '2018-12',
    current: false,
    responsibilities: ['Данные по 200 SKU'],
    achievements: ['Сдали на 2 недели раньше'],
  },
  {
    title: 'Ассистент отдела маркетинга',
    employer: 'Простые Решения',
    location: 'Казань',
    startDate: '2017-03',
    endDate: '2018-05',
    current: false,
    responsibilities: ['Кампании в 3 каналах'],
    achievements: ['-22% стоимость лида'],
  },
];

const ONBOARDING_PARSED = {
  fullName: 'Анна Веретенникова',
  targetRole: 'Продуктовый аналитик',
  about: 'Продуктовый аналитик с опытом в ритейле и e-commerce.',
  contact: { location: 'Дубай, ОАЭ', links: [] },
  experience: ONBOARDING_EXPERIENCE,
  skills: ['SQL', 'A/B тесты', 'Python', 'Tableau', 'Продуктовая аналитика'],
  education: [
    {
      institution: 'НИУ ВШЭ',
      qualification: 'Прикладная математика и информатика',
      startDate: '2014',
      endDate: '2018',
    },
  ],
  courses: [],
  tests: [],
  recommendations: [],
  languages: [
    { name: 'Русский', cefr: 'C2' },
    { name: 'Английский', cefr: 'B2' },
  ],
  rawText: '',
};

/** Session, workspace and resume routes the wizard shell needs to boot. */
export async function stubOnboardingShell(page, { signedIn = true } = {}) {
  const session = signedIn
    ? { username: 'candidate.test', role: 'candidate', candidateId: 'candidate-onboarding-shots' }
    : null;
  await page.route('**/api/v1/auth/**', (route) => route.fulfill(json(session)));
  await page.route('**/api/v1/candidate/workspace', (route) => route.fulfill(json(null)));
  await page.route('**/api/v1/candidate/connections**', (route) => route.fulfill(json([])));
  await page.route('**/api/v1/candidate/resume', (route) =>
    route.fulfill(
      json({
        draft: null,
        savedAt: null,
        projection: null,
        evidenceFreshness: { stale: [], approvedCount: 0 },
      }),
    ),
  );
}

/**
 * The import endpoint: whatever text the candidate typed, the server hands
 * back the same realistic parsed profile (six jobs, education, skills,
 * result numbers) so the review/roles/geo steps have facts to show.
 */
export async function stubOnboardingImport(page, { delayMs = 0 } = {}) {
  await page.route('**/api/v1/candidate/resume/import', async (route) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill(
      json({
        parsed: { ...ONBOARDING_PARSED, rawText: route.request().postDataJSON()?.text ?? '' },
        resume: { draft: null, savedAt: null },
        structuredBy: 'rules',
        factCount: 14,
      }),
    );
  });
}

export { ONBOARDING_EXPERIENCE, ONBOARDING_PARSED };
