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

const SNAPSHOT = {
  candidate: {
    id: CANDIDATE.candidateId,
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  messages: [],
  memory: [],
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
      location: 'Берлин, Германия',
      startDate: 'янв 2023',
      current: true,
      bulletMemoryIds: [],
      employmentType: 'Полная занятость',
      workplaceType: 'hybrid',
      skills: ['Platform Strategy', 'Kubernetes'],
    },
    {
      id: 'exp-2',
      chronologyMemoryId: 'mem-exp-2',
      title: 'Director of Engineering',
      employer: 'FinNova Bank',
      location: 'Берлин, Германия',
      startDate: 'июн 2020',
      endDate: 'янв 2023',
      current: false,
      bulletMemoryIds: [],
    },
  ],
  skills: [
    { id: 'skill-1', name: 'Kubernetes' },
    { id: 'skill-2', name: 'Roadmapping' },
    { id: 'skill-3', name: 'PCI DSS' },
  ],
  education: [
    {
      id: 'edu-1',
      evidenceMemoryId: 'mem-edu-1',
      institution: 'Technical University of Munich',
      qualification: 'MSc Computer Science',
      startDate: '2013',
      endDate: '2015',
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
      text: 'Марина — редкий тип VP, который одинаково свободно говорит с регулятором и с инженером.',
    },
  ],
  languages: [{ id: 'lang-1', evidenceMemoryId: 'mem-lang-1', name: 'Английский', cefr: 'C1' }],
  certifications: [
    {
      id: 'cert-1',
      name: 'AWS Certified Solutions Architect — Professional',
      issuer: 'Amazon Web Services',
      issuedAt: 'апр 2022',
    },
  ],
  projects: [
    {
      id: 'project-1',
      name: 'Payments Core Migration',
      employer: 'FinNova Bank',
      startDate: 'янв 2023',
      endDate: 'сен 2023',
      description: 'Перенос платёжного ядра на Kubernetes с нулевым простоем.',
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

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.screenshot({ path: testInfo.outputPath('profile-1440.png'), fullPage: true });

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

    await page.screenshot({ path: testInfo.outputPath('profile-390.png'), fullPage: true });
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
