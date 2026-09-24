import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * B265 — the rail's «Профиль» replaces Resume Studio with its own screen.
 * This spec checks the whole screen renders every section from a populated
 * v2 draft, at both the desktop (1440) and phone (390) viewports the design
 * gate requires, with no horizontal scroll on the phone.
 */

const CANDIDATE = {
  username: 'profile.candidate',
  email: 'profile.candidate@example.com',
  displayName: 'Марина Соколова',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b265-profile',
};

const ACCOUNT = {
  username: CANDIDATE.username,
  email: CANDIDATE.email,
  displayName: CANDIDATE.displayName,
  profile: {
    headline: 'VP of Engineering',
    location: 'Берлин, Германия',
    workMode: null,
    updatedAt: '2026-09-21T09:00:00.000Z',
  },
  sessions: [],
};

// B265 review round 3 — an imported LinkedIn profile already has confirmed
// facts, so the cross-screen path indicator's «Профиль» step must read
// "Опорные факты подтверждены", not the wizard's generic "Собираем опыт…":
// that reason only fits a candidate with no facts at all yet
// (`careerJourneyEngine.ts` `buildTrack`). Two responsibility facts double as
// the experience section's bullet source (`bulletMemoryIds` below).
function fact(id: string, statement: string) {
  return {
    id,
    kind: 'fact' as const,
    domain: 'responsibility' as const,
    statement,
    confidence: 'candidate-confirmed' as const,
    sourceMessageIds: [],
    sensitive: false,
    status: 'confirmed' as const,
  };
}

const MEMORY = [
  fact(
    'mem-resp-1a',
    'Отвечаю за платформенную и инфраструктурную стратегию для 6 продуктовых команд (58 инженеров).',
  ),
  fact(
    'mem-resp-1b',
    'Провела миграцию платёжного ядра на Kubernetes без простоя, сократив время релиза с 3 недель до 2 дней.',
  ),
  fact(
    'mem-resp-1c',
    'Построила процесс регуляторного аудита PCI DSS с нулевым замечанием по итогам 2025 года.',
  ),
  fact(
    'mem-resp-2a',
    'Собрала три платформенные команды с нуля, наняла 24 инженера за 18 месяцев.',
  ),
  fact('mem-resp-2b', 'Внедрила SLO и on-call ротацию, снизив количество инцидентов P1 на 64%.'),
  fact(
    'mem-resp-3a',
    'Руководила командой из 9 инженеров, отвечавшей за внутреннюю платформу разработки.',
  ),
  fact(
    'mem-resp-3b',
    'Запустила Internal Developer Platform, сократив время выката новой команды с 3 недель до 3 дней.',
  ),
];

const SNAPSHOT = {
  candidate: {
    id: CANDIDATE.candidateId,
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  messages: [],
  memory: MEMORY,
  turns: [],
  dossier: {
    sections: [],
    confirmedCount: 0,
    proposedCount: 0,
    readiness: { complete: true, unresolvedQuestions: 0, checks: [] },
  },
  documents: [],
  assessments: [],
  germanyMarket: null,
  vacancySubscriptions: [],
  importedSources: [
    { platform: 'linkedin', lastImportedAt: '2026-09-21T09:00:00.000Z', factCount: 42 },
  ],
};

const DRAFT = {
  schemaVersion: 2,
  candidate: {
    fullName: 'Марина Соколова',
    headline: 'VP of Engineering · Строю отказоустойчивые платформы для финтеха',
    about:
      '15 лет строю и масштабирую инженерные организации в финтехе и платёжных системах.\n\nЧто делаю лучше всего:\n- Строю инженерную стратегию и roadmap',
    contact: {
      email: 'm.sokolova@example.com',
      phone: '+49 30 555 0142',
      telegram: '@marina_sokolova',
      location: 'Берлин, Германия',
      links: ['marinasokolova.dev'],
      linkedinUrl: 'https://linkedin.com/in/marina-sokolova',
    },
  },
  targetRole: 'VP of Engineering',
  experience: [
    {
      id: 'exp-1',
      chronologyMemoryId: 'mem-exp-1',
      title: 'VP of Engineering',
      employer: 'FinNova Bank',
      employerGroupKey: 'finnova-bank',
      location: 'Берлин, Германия',
      startDate: 'янв 2023',
      current: true,
      bulletMemoryIds: ['mem-resp-1a', 'mem-resp-1b', 'mem-resp-1c'],
      employmentType: 'Полная занятость',
      workplaceType: 'hybrid',
      skills: ['Platform Strategy', 'Kubernetes', 'Team Scaling', 'Fintech Compliance'],
    },
    {
      id: 'exp-2',
      chronologyMemoryId: 'mem-exp-2',
      title: 'Director of Engineering',
      employer: 'FinNova Bank',
      employerGroupKey: 'finnova-bank',
      location: 'Берлин, Германия',
      startDate: 'июн 2020',
      endDate: 'янв 2023',
      current: false,
      bulletMemoryIds: ['mem-resp-2a', 'mem-resp-2b'],
      employmentType: 'Полная занятость',
      workplaceType: 'hybrid',
      skills: ['Hiring', 'Observability', 'Distributed Systems'],
    },
    {
      id: 'exp-3',
      chronologyMemoryId: 'mem-exp-3',
      title: 'Engineering Manager',
      employer: 'Quantel Systems',
      employerGroupKey: 'quantel-systems',
      location: 'Мюнхен, Германия',
      startDate: 'мар 2017',
      endDate: 'май 2020',
      current: false,
      bulletMemoryIds: ['mem-resp-3a', 'mem-resp-3b'],
      employmentType: 'Полная занятость',
      workplaceType: 'remote',
      skills: ['Go', 'CI/CD', 'Terraform'],
    },
  ],
  skills: [
    { id: 'skill-1', name: 'Engineering Leadership' },
    { id: 'skill-2', name: 'Roadmapping' },
    { id: 'skill-3', name: 'Stakeholder Management' },
    { id: 'skill-4', name: 'Hiring & Team Scaling' },
    { id: 'skill-5', name: 'Budget Ownership' },
    { id: 'skill-6', name: 'OKRs' },
    { id: 'skill-7', name: 'Kubernetes' },
    { id: 'skill-8', name: 'AWS' },
    { id: 'skill-9', name: 'Terraform' },
    { id: 'skill-10', name: 'Distributed Systems' },
    { id: 'skill-11', name: 'Observability' },
    { id: 'skill-12', name: 'CI/CD' },
    { id: 'skill-13', name: 'Go' },
    { id: 'skill-14', name: 'TypeScript' },
    { id: 'skill-15', name: 'Python' },
    { id: 'skill-16', name: 'PostgreSQL' },
    { id: 'skill-17', name: 'gRPC' },
    { id: 'skill-18', name: 'React' },
    { id: 'skill-19', name: 'Fintech Compliance' },
    { id: 'skill-20', name: 'PCI DSS' },
    { id: 'skill-21', name: 'Payments' },
    { id: 'skill-22', name: 'Risk Management' },
    { id: 'skill-23', name: 'Product Strategy' },
    { id: 'skill-24', name: 'BaFin Audits' },
  ],
  education: [
    {
      id: 'edu-1',
      evidenceMemoryId: 'mem-edu-1',
      institution: 'Technical University of Munich',
      qualification: 'MSc Computer Science',
      startDate: '2013',
      endDate: '2015',
      description:
        'Специализация — распределённые системы. Диплом о масштабировании консенсус-протоколов для платёжных сетей с высокой доступностью.',
    },
    {
      id: 'edu-2',
      evidenceMemoryId: 'mem-edu-2',
      institution: 'Novosibirsk State University',
      qualification: 'BSc Applied Mathematics',
      startDate: '2008',
      endDate: '2012',
    },
  ],
  courses: [],
  tests: [],
  recommendations: [
    {
      id: 'rec-1',
      recommender: 'Daniel Voss',
      organization: 'FinNova Bank',
      position: 'CTO',
      text: 'Марина — редкий тип VP, который одинаково свободно говорит с регулятором и с инженером на pull request. Миграция платёжного ядра прошла без единого инцидента под её руководством.',
    },
    {
      id: 'rec-2',
      recommender: 'Elena Bauer',
      organization: 'Quantel Systems',
      position: 'Senior Product Manager',
      text: 'Работали вместе три года в Quantel. Марина умеет превратить неопределённый продуктовый запрос в понятный инженерный план за один созвон.',
    },
  ],
  languages: [
    {
      id: 'lang-1',
      evidenceMemoryId: 'mem-lang-1',
      name: 'Английский',
      cefr: 'C1',
      sourceLabel: 'Full professional proficiency',
    },
    {
      id: 'lang-2',
      evidenceMemoryId: 'mem-lang-2',
      name: 'Немецкий',
      cefr: 'B2',
      sourceLabel: 'Professional working proficiency',
    },
    {
      id: 'lang-3',
      evidenceMemoryId: 'mem-lang-3',
      name: 'Русский',
      cefr: 'C2',
      sourceLabel: 'Native or bilingual proficiency',
    },
  ],
  certifications: [
    {
      id: 'cert-1',
      name: 'AWS Certified Solutions Architect — Professional',
      issuer: 'Amazon Web Services',
      issuedAt: 'апр 2022',
      expiresAt: 'апр 2025',
    },
    {
      id: 'cert-2',
      name: 'Certified Kubernetes Administrator (CKA)',
      issuer: 'Cloud Native Computing Foundation',
      issuedAt: 'ноя 2021',
    },
  ],
  projects: [
    {
      id: 'project-1',
      name: 'Payments Core Migration',
      employer: 'FinNova Bank',
      startDate: 'янв 2023',
      endDate: 'сен 2023',
      description:
        'Перенос платёжного ядра на Kubernetes с нулевым простоем для 40 млн транзакций в сутки.',
    },
    {
      id: 'project-2',
      name: 'Internal Developer Platform',
      employer: 'Quantel Systems',
      startDate: '2019',
      description:
        'Платформа самообслуживания для 9 команд: шаблоны сервисов, CI/CD, наблюдаемость из коробки.',
    },
  ],
  achievements: [
    {
      id: 'achievement-1',
      kind: 'honor',
      title: 'Fintech Engineering Leader of the Year',
      issuer: 'Berlin Tech Awards',
      date: '2023',
    },
    {
      id: 'achievement-2',
      kind: 'publication',
      title: 'Scaling Payment Systems for Regulatory Change',
      issuer: 'Engineering Blog',
      date: '2022',
    },
    {
      id: 'achievement-3',
      kind: 'volunteering',
      title: 'Ментор',
      issuer: 'Berlin Women in Tech',
      date: '2021',
    },
  ],
  sourceSuggestions: {
    openToWork: {
      roles: ['VP of Engineering', 'Director of Engineering'],
      locations: ['Берлин', 'Remote (EU)'],
      workplaceTypes: ['hybrid', 'remote'],
    },
  },
};

async function stubSession(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
    if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
    if (pathname === '/api/v1/account/profile') {
      return route.fulfill({ json: { data: ACCOUNT } });
    }
    if (pathname === '/api/v1/candidate/workspace') {
      return route.fulfill({
        json: {
          data: {
            version: 7,
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
            resumeText: 'VP of Engineering with 15 years in fintech platforms.',
            resumeSource: 'text',
            targetDirection: 'VP of Engineering',
            regions: ['de'],
            currentSituation: 'Ищу следующую VP-роль.',
            constraints: '',
            urgency: 'active',
            outcomes: [],
          },
        },
      });
    }
    if (pathname === '/api/v1/candidate/resume') {
      return route.fulfill({
        json: {
          data: {
            draft: DRAFT,
            savedAt: {
              createdAt: '2026-09-21T09:00:00.000Z',
              updatedAt: '2026-09-21T09:00:00.000Z',
            },
            projection: { evidenceSnapshot: [], master: null, germany: null },
            evidenceFreshness: { stale: [] },
          },
        },
      });
    }
    return route.fulfill({ json: { data: null } });
  });
}

async function seedWorkspace(page: Page): Promise<void> {
  await page.addInitScript(
    ({ storageKey, ownerKey, candidateId, workspace }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(workspace));
      window.localStorage.setItem(ownerKey, candidateId);
    },
    {
      storageKey: 'candidate-workspace',
      ownerKey: 'candidate-workspace-owner',
      candidateId: CANDIDATE.candidateId,
      workspace: {
        version: 7,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        resumeText: 'VP of Engineering with 15 years in fintech platforms.',
        resumeSource: 'text',
        targetDirection: 'VP of Engineering',
        regions: ['de'],
        currentSituation: 'Ищу следующую VP-роль.',
        constraints: '',
        urgency: 'active',
        outcomes: [],
      },
    },
  );
}

async function openProfile(page: Page): Promise<void> {
  await seedWorkspace(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.getByRole('button', { name: 'Профиль', exact: true }).click();
  await expect(page.locator('.career-profile-screen-view')).toBeVisible();
}

/**
 * `.career-main` scrolls internally (`overflow: auto`), so neither
 * `page.screenshot({ fullPage: true })` nor `locator.screenshot()` captures
 * more than one viewport of it — the first only measures `<body>`, which
 * never grows, and the second clips to the element's own (viewport-sized)
 * box rather than its scrollable content. Forcing the scroller to lay out at
 * its full content height turns the whole page into one tall flow so a
 * plain full-page screenshot shows every section, top to bottom.
 */
async function screenshotFullProfilePage(page: Page, path: string): Promise<void> {
  await page.addStyleTag({
    content: `.career-shell, .career-main { overflow: visible !important; height: auto !important; min-height: 0 !important; }`,
  });
  await page.screenshot({ path, fullPage: true });
}

const SECTION_IDS = [
  'sec-about',
  'sec-experience',
  'sec-education',
  'sec-skills',
  'sec-certificates',
  'sec-projects',
  'sec-courses',
  'sec-languages',
  'sec-recommendations',
  'sec-achievements',
] as const;

test.describe('B265 Profile screen', () => {
  test('shows every section from an imported v2 draft, desktop 1440', async ({
    page,
  }, testInfo) => {
    await stubSession(page);
    await openProfile(page);

    await expect(page.locator('.career-profile-screen-topcard')).toContainText('Марина Соколова');
    await expect(page.locator('.career-profile-screen-otw')).toContainText('Open to work');

    for (const id of SECTION_IDS) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
    await expect(page.locator('#sec-courses')).toContainText(
      'Раздел действительно пуст в источнике',
    );
    await expect(page.locator('.career-profile-screen-coverage')).toBeVisible();
    await expect(page.locator('.career-profile-screen-position-bullets li').first()).toBeVisible();
    await expect(page.locator('.career-profile-screen-lang-source').first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await screenshotFullProfilePage(page, testInfo.outputPath('profile-1440.png'));

    const accessibility = await new AxeBuilder({ page })
      .include('.career-profile-screen-view')
      .analyze();
    expect(accessibility.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });

  test('shows every section with no horizontal scroll, phone 390', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubSession(page);
    await openProfile(page);

    for (const id of SECTION_IDS) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await screenshotFullProfilePage(page, testInfo.outputPath('profile-390.png'));
  });

  test('confirms the Open to work proposal without a page redirect', async ({ page }) => {
    let patched: Record<string, unknown> | undefined;
    await stubSession(page);
    // Registered after the catch-all so it wins for this one path (Playwright
    // matches the most recently added route first).
    await page.route('**/api/v1/account/profile', async (route) => {
      patched = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { data: ACCOUNT } });
    });
    await openProfile(page);

    await page.getByRole('button', { name: 'Подтвердить и применить к целям поиска' }).click();
    await expect(page).toHaveURL(/\/app/);
    await expect.poll(() => patched).toMatchObject({ workMode: expect.any(String) });
  });
});
