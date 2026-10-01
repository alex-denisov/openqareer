import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureCareerHarness } from './helpers/capture-career-harness';
import type { MatchedVacancyItem } from '../src/features/coach/cabinetTypes';

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

const C66_VACANCY: MatchedVacancyItem = {
  cluster: {
    id: 'c66-platform-vacancy',
    canonicalTitle: 'Platform Engineer',
    canonicalCompany: 'Acme Systems',
    canonicalLocation: 'Берлин',
    isRemote: true,
    salary: { from: 120_000, to: 150_000, currency: 'EUR' },
    descriptionSummary: 'Развитие внутренней платформы.',
    skills: ['Kubernetes'],
    primaryUrl: 'https://hh.ru/vacancy/c66-1',
    sources: [
      {
        sourceType: 'hh',
        sourceId: 'c66-platform-vacancy',
        sourceName: 'hh.ru',
        sourceUrl: 'https://hh.ru/vacancy/c66-1',
        observedAt: '2026-09-28T08:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-09-28T08:00:00.000Z',
    lastSeenAt: '2026-09-28T08:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  },
  explanation: {
    clusterId: 'c66-platform-vacancy',
    roleMatch: 'target',
    levelMatch: 'match',
    outsideGeography: false,
    matchingPoints: [],
    missingPoints: ['Опыт работы с Kubernetes'],
    summary: '',
    calculatedAt: '2026-09-28T08:00:00.000Z',
  },
};

async function stubSession(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
    if (pathname === '/api/v1/candidate/me/messages') {
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    }
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
    if (pathname === '/api/v1/candidate/search-consent') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as { granted?: boolean } | null;
        return route.fulfill({
          json: {
            data: {
              consent: {
                granted: Boolean(body?.granted),
                policyVersion: 'search-consent-2026-09-27',
                updatedAt: new Date().toISOString(),
              },
            },
          },
        });
      }
      return route.fulfill({
        json: {
          data: {
            consent: {
              granted: false,
              policyVersion: 'search-consent-2026-09-27',
              updatedAt: '2026-09-21T09:00:00.000Z',
            },
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
  test('shows the saved reader method beside the source chip', async ({ page }) => {
    await stubSession(page);
    await page.route('**/api/v1/candidate/resume', async (route) => {
      await route.fulfill({
        json: {
          data: {
            draft: DRAFT,
            savedAt: {
              createdAt: '2026-09-21T09:00:00.000Z',
              updatedAt: '2026-09-21T09:00:00.000Z',
            },
            projection: { evidenceSnapshot: [], master: null, germany: null },
            evidenceFreshness: { stale: [] },
            reader: {
              method: 'model',
              model: 'openai:gpt-5.6-mini',
              promptRevision: 'resume-structuring-v1',
              readAt: '2026-09-26T10:00:00.000Z',
            },
          },
        },
      });
    });
    await openProfile(page);

    const row = page.locator('.career-profile-screen-status-row');
    const readerStatus = row.locator('.career-profile-screen-reader-status');
    await expect(readerStatus).toHaveText('Прочитано моделью');
    await expect(row.locator('.career-profile-screen-source-chip')).toBeVisible();
    await expect(page.getByText('Резюме прочитано: неизвестно', { exact: true })).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page })
      .include('.career-profile-screen-view')
      .analyze();
    expect(accessibility.violations.filter((violation) => violation.impact === 'critical')).toEqual(
      [],
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    const width = page.viewportSize()?.width ?? 0;
    const outputDir = join(process.cwd(), 'test-results', 'c67-reader-provenance');
    mkdirSync(outputDir, { recursive: true });
    await page.screenshot({ path: join(outputDir, 'profile-reader-' + width + '.png') });
    const snapshot = await page.evaluate(() => {
      const styles = Array.from(document.styleSheets)
        .flatMap((sheet) => {
          try {
            return Array.from(sheet.cssRules, (rule) => rule.cssText);
          } catch {
            return [];
          }
        })
        .join('\n');
      const html = document.documentElement.outerHTML
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
        .replace(/<link\b(?=[^>]*rel=["']stylesheet["'])[^>]*>/giu, '');
      return html.replace('</head>', '<style>' + styles + '</style></head>');
    });
    expect(snapshot.length).toBeGreaterThan(10_000);
    writeFileSync(join(outputDir, 'profile-reader-' + width + '.html'), snapshot);
  });

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
    await expect(page.locator('#sec-courses')).toContainText('Импорт из LinkedIn курсов не нашёл');
    // C54: полнота импорта живёт в раскрывающемся чипе источника на шапке профиля.
    await page.locator('.career-profile-screen-source-chip summary').click();
    await expect(page.locator('.career-profile-screen-coverage')).toBeVisible();
    await expect(page.locator('.career-profile-screen-position-bullets li').first()).toBeVisible();
    await expect(page.locator('.career-profile-screen-lang-source').first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await screenshotFullProfilePage(page, 'output/playwright/C74/profile-1440.png');
    await screenshotFullProfilePage(page, 'output/playwright/B265/profile-1440.png');
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

    // C74: candidate name is visible without scrolling on 390
    const nameHeading = page.locator('.career-profile-screen-name-row h1');
    await expect(nameHeading).toBeVisible();
    const nameBox = await nameHeading.boundingBox();
    expect(nameBox).not.toBeNull();
    expect(nameBox!.y).toBeLessThan(844);

    // C74: details toggle is present and collapsed by default
    const detailsToggle = page.locator('.career-profile-screen-details-toggle');
    await expect(detailsToggle).toBeVisible();
    await expect(detailsToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(detailsToggle).toContainText('Подробнее');

    for (const id of SECTION_IDS) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.screenshot({
      path: 'output/playwright/C74/profile-390.png',
      fullPage: false,
    });
    await page.screenshot({
      path: 'output/playwright/B265/profile-390.png',
      fullPage: false,
    });
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

  test('C58: inline consultant suggestion on About section: accept and revert', async ({
    page,
  }, testInfo) => {
    let approvedCommandId = '';
    let revertedCommandId = '';
    let approvalAttempts = 0;
    let profileRevisionReverted = false;
    let currentStatus = 'awaiting_approval';

    const sampleCommand = {
      commandId: 'cmd-revise-about-1',
      candidateId: CANDIDATE.candidateId,
      turnIdempotencyKey: 'turn-c58-1',
      capability: 'resume.revise',
      status: currentStatus,
      proposal: {
        actionKind: 'revise_profile',
        title: 'Уточнение формулировки в разделе «Обо мне»',
        objective: 'Сделать акцент на платформенной стратегии и финтех-комплаенсе',
        suggestedNextState: 'confirmed',
        estimatedRisk: 'low',
        evidenceRefs: ['memory:mem-resp-1a'],
      },
      executionTarget: {
        section: 'about',
        proposedText:
          '15 лет строю инженерные организации в финтехе. Усилила стратегию платформы и комплаенс.',
        currentText: DRAFT.candidate.about,
      },
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
    };

    await stubSession(page);

    await page.route('**/api/v1/candidate/career-commands', async (route) => {
      await route.fulfill({
        json: {
          data: [
            {
              ...sampleCommand,
              status: currentStatus,
              ...(profileRevisionReverted ? { profileRevisionReverted: true } : {}),
            },
          ],
        },
      });
    });

    await page.route('**/api/v1/candidate/career-commands/*/approvals', async (route) => {
      const url = route.request().url();
      const parts = url.split('/');
      approvalAttempts += 1;
      if (approvalAttempts === 1) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'resume_revision_stale',
              message: 'Профиль изменился после подготовки. Обновите предложение перед повтором.',
            },
          },
        });
      }
      approvedCommandId = parts[parts.indexOf('career-commands') + 1];
      currentStatus = 'completed_with_receipt';
      await route.fulfill({
        json: {
          data: {
            commandId: approvedCommandId,
            status: 'completed_with_receipt',
          },
        },
      });
    });

    await page.route('**/api/v1/candidate/career-commands/*/revert', async (route) => {
      const url = route.request().url();
      const parts = url.split('/');
      revertedCommandId = parts[parts.indexOf('career-commands') + 1];
      profileRevisionReverted = true;
      await route.fulfill({
        json: {
          data: {
            commandId: revertedCommandId,
            status: 'completed_with_receipt',
          },
        },
      });
    });

    await openProfile(page);

    const suggestion = page.locator('[data-testid="consultant-suggestion-cmd-revise-about-1"]');
    await expect(suggestion).toBeVisible();
    await expect(suggestion).toContainText('Сейчас');
    await expect(suggestion).toContainText('Станет');
    await expect(suggestion).toContainText('Сделать акцент на платформенной стратегии');
    await mkdir('output/playwright/C58', { recursive: true });

    if (testInfo.project.name === 'desktop-1440') {
      await suggestion.screenshot({
        path: 'output/playwright/C58/suggestion-desktop-1440.png',
      });
    } else if (testInfo.project.name === 'mobile-390') {
      await suggestion.screenshot({
        path: 'output/playwright/C58/suggestion-mobile-390.png',
      });
    }
    await captureCareerHarness(page, testInfo.outputPath('profile-c58-suggestion.html'));

    // A stale profile is reported and the proposal stays available for retry.
    await suggestion.getByRole('button', { name: 'Принять' }).click();
    await expect(suggestion.getByRole('alert')).toContainText('Профиль изменился после подготовки');
    await expect(suggestion.getByRole('button', { name: 'Принять' })).toBeVisible();
    if (testInfo.project.name === 'mobile-390') {
      await suggestion.screenshot({
        path: 'output/playwright/C58/suggestion-error-mobile-390.png',
      });
    } else if (testInfo.project.name === 'desktop-1440') {
      await suggestion.screenshot({
        path: 'output/playwright/C58/suggestion-error-desktop-1440.png',
      });
    }
    await captureCareerHarness(page, testInfo.outputPath('profile-c58-error.html'));

    // Accept suggestion after the retry.
    await suggestion.getByRole('button', { name: 'Принять' }).click();
    await expect.poll(() => approvedCommandId).toBe('cmd-revise-about-1');
    await expect(suggestion).toContainText('Правка применена');
    if (testInfo.project.name === 'mobile-390') {
      await suggestion.screenshot({
        path: 'output/playwright/C58/suggestion-applied-mobile-390.png',
      });
    } else if (testInfo.project.name === 'desktop-1440') {
      await suggestion.screenshot({
        path: 'output/playwright/C58/suggestion-applied-desktop-1440.png',
      });
    }

    // Revert suggestion
    await suggestion.getByRole('button', { name: 'Откатить' }).click();
    await expect.poll(() => revertedCommandId).toBe('cmd-revise-about-1');
    await expect(suggestion).toHaveCount(0);
  });

  test('C58: a grounded consultant proposal is prepared before it appears in the Profile', async ({
    page,
  }) => {
    const turnResult = {
      message: 'Предлагаю обновить раздел «Обо мне» по подтверждённым фактам.',
      phase: 'resume',
      nextQuestion: null,
      memoryCandidates: [],
      completeness: { known: ['Платформенная стратегия'], unknown: [] },
      safety: { needsHuman: false, reason: null },
      careerTrack: null,
      actionProposals: [
        {
          kind: 'resume.revise',
          objective: 'Уточнить блок «Обо мне» фактами о платформенной стратегии.',
          evidenceRefs: ['memory:mem-resp-1a'],
          acceptanceCriteria: ['Формулировка опирается на факты профиля.'],
          expectedSignal: 'Блок «Обо мне» стал конкретнее.',
          measureAfter: '2026-10-01',
          risk: 'candidate_data_write',
          resumeRevision: {
            section: 'about',
            experienceId: null,
            memoryId: null,
            proposedText: '15 лет строю инженерные организации в финтехе и платёжных системах.',
          },
        },
      ],
    };
    const commandId = 'f51b5f4e-1f64-4f5a-a644-529367728a77';
    let turnIdempotencyKey = '';
    let preparedBody: Record<string, unknown> | undefined;
    let preparedCommand: Record<string, unknown> | undefined;

    await stubSession(page);
    await page.route('**/api/v1/coach/turn**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === '/api/v1/coach/turn') {
        turnIdempotencyKey = String(request.headers()['idempotency-key']);
        return route.fulfill({
          status: 202,
          json: { data: { status: 'pending', idempotencyKey: turnIdempotencyKey } },
        });
      }
      return route.fulfill({ json: { data: turnResult } });
    });
    await page.route('**/api/v1/candidate/career-commands**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/candidate/career-commands' && request.method() === 'GET') {
        return route.fulfill({ json: { data: preparedCommand ? [preparedCommand] : [] } });
      }
      if (pathname === '/api/v1/candidate/career-commands' && request.method() === 'POST') {
        preparedBody = request.postDataJSON() as Record<string, unknown>;
        const proposal = turnResult.actionProposals[0];
        preparedCommand = {
          schemaVersion: 'career-command-v1',
          commandId,
          candidateId: CANDIDATE.candidateId,
          capability: 'resume.revise',
          proposal,
          executionTarget: {
            targetType: 'resume_block',
            section: 'about',
            currentText: DRAFT.candidate.about,
            proposedText: proposal.resumeRevision.proposedText,
          },
          status: 'awaiting_approval',
          provenance: {
            strategyDecisionId: turnIdempotencyKey,
            evidenceRefs: proposal.evidenceRefs,
            modelInvocationIds: [],
          },
          authorization: { approvalId: null },
          idempotency: {
            key: String(request.headers()['idempotency-key']),
            payloadDigest: 'a'.repeat(64),
            semantics: 'at_most_once',
          },
          execution: null,
          createdAt: '2026-09-28T00:00:00.000Z',
          updatedAt: '2026-09-28T00:00:00.000Z',
        };
        return route.fulfill({ status: 201, json: { data: preparedCommand } });
      }
      return route.fulfill({ json: { data: null } });
    });

    await openProfile(page);
    await page.locator('button[aria-label="Консультант"]:visible').click();
    const expert = page.getByRole('dialog', { name: 'Карьерный эксперт' });
    await expert
      .getByLabel('Сообщение карьерному консультанту')
      .fill('Обнови раздел «Обо мне» по фактам профиля.');
    await expert.getByRole('button', { name: 'Отправить вопрос' }).click();
    await expert.getByRole('button', { name: 'Подготовить правку для Профиля' }).click();
    await expect.poll(() => preparedBody).toMatchObject({ proposalIndex: 0 });
    expect(turnIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(preparedBody).not.toHaveProperty('executionTarget');

    await expert.getByRole('button', { name: 'Закрыть карьерного консультанта' }).click();
    const suggestion = page.locator(`[data-testid="consultant-suggestion-${commandId}"]`);
    await expect(suggestion).toBeVisible();
    await expect(suggestion).toContainText('Сейчас');
    await expect(suggestion).toContainText('Станет');
    await expect(suggestion).toContainText('15 лет строю инженерные организации');
    await expect(suggestion.getByRole('button', { name: 'Принять' })).toBeVisible();
  });

  test('C66: a missing vacancy requirement opens its grounded fact in Experience', async ({
    page,
  }, testInfo) => {
    const requirement = C66_VACANCY.explanation.missingPoints[0]!;
    const commandId = 'c66b5f4e-1f64-4f5a-a644-529367728a77';
    const memoryId = 'mem-resp-1b';
    const currentText = MEMORY.find((item) => item.id === memoryId)!.statement;
    const proposedText =
      'Мигрировала платёжное ядро на Kubernetes без простоя, сократив время релиза с 3 недель до 2 дней.';
    const turnResult = {
      message: 'Есть подтверждённый факт о миграции ядра на Kubernetes.',
      phase: 'resume',
      nextQuestion: null,
      memoryCandidates: [],
      completeness: { known: ['Миграция платёжного ядра'], unknown: [] },
      safety: { needsHuman: false, reason: null },
      careerTrack: null,
      actionProposals: [
        {
          kind: 'resume.revise',
          objective: 'Подтвердить опыт Kubernetes фактом миграции платёжного ядра.',
          evidenceRefs: [`memory:${memoryId}`],
          acceptanceCriteria: ['Формулировка точно повторяет подтверждённый факт.'],
          expectedSignal: 'Требование вакансии совпадает с фактом опыта.',
          measureAfter: '2026-10-01',
          risk: 'candidate_data_write',
          resumeRevision: {
            section: 'experience',
            experienceId: 'exp-1',
            memoryId,
            proposedText,
          },
        },
      ],
    };
    let turnIdempotencyKey = '';
    let turnContent = '';
    let preparedBody: Record<string, unknown> | undefined;
    let preparedCommand: Record<string, unknown> | undefined;
    let accepted = false;
    let matchedReadsAfterAccept = 0;

    await stubSession(page);
    await seedWorkspace(page);
    await page.route('**/api/v1/candidate/me', async (route) => {
      const memory = MEMORY.map((fact) =>
        accepted && fact.id === memoryId ? { ...fact, statement: proposedText } : fact,
      );
      return route.fulfill({ json: { data: { ...SNAPSHOT, memory } } });
    });
    await page.route('**/api/v1/candidate/matched-vacancies**', async (route) => {
      if (accepted) matchedReadsAfterAccept += 1;
      const item = accepted
        ? {
            ...C66_VACANCY,
            explanation: {
              ...C66_VACANCY.explanation,
              matchingPoints: [requirement],
              missingPoints: [],
            },
          }
        : C66_VACANCY;
      return route.fulfill({
        json: { data: [item], meta: { total: 1, nextOffset: null, pageOffsets: [0] } },
      });
    });
    await page.route('**/api/v1/candidate/vacancy-sources', (route) =>
      route.fulfill({ json: { data: [] } }),
    );
    await page.route('**/api/v1/candidate/vacancy-applications', (route) =>
      route.fulfill({ json: { data: [] } }),
    );
    await page.route('**/api/v1/candidate/applications', (route) =>
      route.fulfill({ json: { data: [] } }),
    );
    await page.route('**/api/v1/coach/turn**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === '/api/v1/coach/turn') {
        turnIdempotencyKey = String(request.headers()['idempotency-key']);
        turnContent = String((request.postDataJSON() as { content?: unknown }).content ?? '');
        return route.fulfill({
          status: 202,
          json: { data: { status: 'pending', idempotencyKey: turnIdempotencyKey } },
        });
      }
      return route.fulfill({ json: { data: turnResult } });
    });
    await page.route('**/api/v1/candidate/career-commands**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/candidate/career-commands' && request.method() === 'GET') {
        return route.fulfill({ json: { data: preparedCommand ? [preparedCommand] : [] } });
      }
      if (pathname === '/api/v1/candidate/career-commands' && request.method() === 'POST') {
        preparedBody = request.postDataJSON() as Record<string, unknown>;
        const proposal = turnResult.actionProposals[0];
        preparedCommand = {
          schemaVersion: 'career-command-v1',
          commandId,
          candidateId: CANDIDATE.candidateId,
          capability: 'resume.revise',
          proposal,
          executionTarget: {
            targetType: 'resume_block',
            section: 'experience',
            experienceId: 'exp-1',
            memoryId,
            currentText,
            proposedText,
          },
          status: 'awaiting_approval',
          provenance: {
            strategyDecisionId: turnIdempotencyKey,
            evidenceRefs: proposal.evidenceRefs,
            modelInvocationIds: [],
          },
          authorization: { approvalId: null },
          idempotency: {
            key: String(request.headers()['idempotency-key']),
            payloadDigest: 'b'.repeat(64),
            semantics: 'at_most_once',
          },
          execution: null,
          createdAt: '2026-09-28T00:00:00.000Z',
          updatedAt: '2026-09-28T00:00:00.000Z',
        };
        return route.fulfill({ status: 201, json: { data: preparedCommand } });
      }
      if (pathname.endsWith('/approvals') && request.method() === 'POST') {
        accepted = true;
        preparedCommand = { ...preparedCommand, status: 'completed_with_receipt' };
        return route.fulfill({ json: { data: preparedCommand } });
      }
      return route.fulfill({ json: { data: null } });
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await page.locator('button[aria-label="Вакансии"]:visible').first().click();
    const vacancy = page.locator('.vac-list-item').first();
    await expect(vacancy).toContainText('Platform Engineer');
    const rowToggle = vacancy.locator('button[aria-expanded]').first();
    if ((await rowToggle.getAttribute('aria-expanded')) !== 'true') await rowToggle.click();
    await page
      .locator('.vacancies-detail-panel')
      .getByRole('button', { name: 'Добавить в профиль' })
      .click();

    await expect(page.locator('#sec-experience')).toBeVisible();
    await expect.poll(() => turnContent).toContain(requirement);
    const suggestion = page.locator(`[data-testid="consultant-suggestion-${commandId}"]`);
    await expect(suggestion).toBeVisible();
    expect(turnIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    await expect.poll(() => preparedBody).toMatchObject({ proposalIndex: 0 });
    expect(preparedBody).not.toHaveProperty('executionTarget');
    const accessibility = await new AxeBuilder({ page }).include('#sec-experience').analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      ),
    ).toEqual([]);
    await mkdir('output/playwright/C66', { recursive: true });
    const viewport = testInfo.project.name === 'mobile-390' ? 'mobile-390' : 'desktop-1440';
    await suggestion.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/C66/requirement-${viewport}.png` });
    await captureCareerHarness(page, testInfo.outputPath('vacancy-requirement-profile.html'));

    await suggestion.getByRole('button', { name: 'Принять' }).click();
    await expect(suggestion).toContainText('Правка применена');
    await expect.poll(() => accepted).toBe(true);
    await expect.poll(() => matchedReadsAfterAccept).toBeGreaterThan(0);
    await page.locator('button[aria-label="Вакансии"]:visible').first().click();
    const reopenedToggle = page
      .locator('.vac-list-item')
      .first()
      .locator('button[aria-expanded]')
      .first();
    if ((await reopenedToggle.getAttribute('aria-expanded')) !== 'true')
      await reopenedToggle.click();
    await expect(
      page.locator('.req-block').filter({ hasText: 'Совпадает по фактам профиля' }),
    ).toContainText(requirement);
    await expect(
      page
        .locator('.req-block')
        .filter({ hasText: 'Требования вакансии, которых нет в вашем профиле' }),
    ).toHaveCount(0);
  });

  test('переключает статус «Вы в поиске» (включить -> выключить) на desktop 1440 (C64)', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let consentState = {
      granted: false,
      policyVersion: 'search-consent-2026-09-27',
      updatedAt: '2026-09-21T09:00:00.000Z',
    };
    await stubSession(page);
    await page.route('**/api/v1/candidate/search-consent', async (route) => {
      const request = route.request();
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as { granted?: boolean } | null;
        consentState = {
          granted: Boolean(body?.granted),
          policyVersion: 'search-consent-2026-09-27',
          updatedAt: new Date().toISOString(),
        };
        return route.fulfill({ json: { data: { consent: consentState } } });
      }
      return route.fulfill({ json: { data: { consent: consentState } } });
    });

    await openProfile(page);

    const consentRow = page.locator('.career-profile-screen-search-consent');
    await expect(consentRow).toBeVisible();
    await expect(consentRow).toContainText('Вы в поиске');
    await expect(consentRow).toContainText('выключено');

    const toggleBtn = consentRow.getByRole('button', { name: /Включить|Выключить/ });
    await expect(toggleBtn).toHaveText('Включить');
    await toggleBtn.click();

    await expect(consentRow).toContainText('включено');
    await expect(toggleBtn).toHaveText('Выключить');

    await toggleBtn.click();
    await expect(consentRow).toContainText('выключено');
    await expect(toggleBtn).toHaveText('Включить');

    await page.screenshot({ path: 'output/playwright/C64/profile-search-consent-1440.png' });
    await page.screenshot({
      path: testInfo.outputPath('profile-search-consent-1440.png'),
    });
  });

  test('переключает статус «Вы в поиске» (включить -> выключить) на mobile 390 (C64)', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let consentState = {
      granted: false,
      policyVersion: 'search-consent-2026-09-27',
      updatedAt: '2026-09-21T09:00:00.000Z',
    };
    await stubSession(page);
    await page.route('**/api/v1/candidate/search-consent', async (route) => {
      const request = route.request();
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as { granted?: boolean } | null;
        consentState = {
          granted: Boolean(body?.granted),
          policyVersion: 'search-consent-2026-09-27',
          updatedAt: new Date().toISOString(),
        };
        return route.fulfill({ json: { data: { consent: consentState } } });
      }
      return route.fulfill({ json: { data: { consent: consentState } } });
    });

    await openProfile(page);

    const consentRow = page.locator('.career-profile-screen-search-consent');
    await expect(consentRow).toBeVisible();
    await expect(consentRow).toContainText('Вы в поиске');
    await expect(consentRow).toContainText('выключено');

    const toggleBtn = consentRow.getByRole('button', { name: /Включить|Выключить/ });
    await expect(toggleBtn).toHaveText('Включить');
    await toggleBtn.click();

    await expect(consentRow).toContainText('включено');
    await expect(toggleBtn).toHaveText('Выключить');

    await toggleBtn.click();
    await expect(consentRow).toContainText('выключено');
    await expect(toggleBtn).toHaveText('Включить');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.screenshot({ path: 'output/playwright/C64/profile-search-consent-390.png' });
    await page.screenshot({
      path: testInfo.outputPath('profile-search-consent-390.png'),
    });
  });

  test('D24: вкладка «Документ и форматы» сразу раскрыта без дублирующей кнопки', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openProfile(page);

    const docTab = page
      .locator('.career-profile-screen-tabs')
      .getByRole('button', { name: 'Документ и форматы' });
    await docTab.click();

    await expect(page.locator('.career-profile-screen-document-menu')).toBeVisible();
    await expect(page.locator('.career-resume-formats')).toBeVisible();
    await expect(page.locator('.career-resume-formats')).toContainText('Stanford PDF');
    await expect(
      page.locator('.career-profile-screen-view > button.career-quiet-button'),
    ).toHaveCount(0);
  });
});
