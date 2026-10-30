import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureCareerHarness } from './helpers/capture-career-harness';
import { waitForCareerShell } from './helpers/waitForCareerShell';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { captureScrollableScreen } from '../scripts/block0-screenshot';
import type { MatchedVacancyItem } from '../src/features/coach/cabinetTypes';
import type { CandidateMemory, ImportedSourceSummary } from '../src/features/coach/coachApi';
import { previewProjection } from '../src/features/resume/resumeStudioModel';
import { closeConsultant } from './helpers/close-consultant';

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

const S10_EVIDENCE_DIR = e2eEvidenceDirectory('S10-VIS');

test.beforeAll(() => mkdirSync(S10_EVIDENCE_DIR, { recursive: true }));

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
function fact(id: string, statement: string, sourceMessageIds: string[] = []) {
  return {
    id,
    kind: 'fact' as const,
    domain: 'responsibility' as const,
    statement,
    confidence: 'candidate-confirmed' as const,
    sourceMessageIds,
    sensitive: false,
    status: 'confirmed' as const,
  };
}

function manualExperienceStatement(entry: {
  readonly title?: string;
  readonly employer?: string;
  readonly location?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly current?: boolean;
  readonly employmentType?: string;
  readonly workplaceType?: string;
  readonly skills?: readonly string[];
}): string {
  const fields: readonly [string, string | boolean | undefined][] = [
    ['Должность', entry.title],
    ['Работодатель', entry.employer],
    ['Локация', entry.location],
    ['Начало', entry.startDate],
    ['Окончание', entry.endDate],
    ['Текущая роль', entry.current],
    ['Занятость', entry.employmentType],
    ['Формат работы', entry.workplaceType],
    ['Навыки на этом месте', entry.skills?.join(', ')],
  ];
  const lines = fields.flatMap(([label, value]) => {
    if (typeof value === 'boolean') return [`${label}: ${value ? 'Да' : 'Нет'}`];
    const content = value?.trim();
    return content ? [`${label}: ${content}`] : [];
  });
  return `Место работы\n${lines.join('\n')}`;
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

async function stubSession(
  page: Page,
  importedSources?: readonly ImportedSourceSummary[],
): Promise<void> {
  const snapshot = importedSources
    ? { ...SNAPSHOT, importedSources: [...importedSources] }
    : SNAPSHOT;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: snapshot } });
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
    if (pathname === '/api/v1/candidate/resume/versions') {
      return route.fulfill({
        json: {
          data: {
            items: [],
            nextCursor: null,
            totalCount: 0,
            currentMasterRevision: 'master-revision-profile-screen',
          },
        },
      });
    }
    if (pathname === '/api/v1/candidate/resume/ats-assessment') {
      return route.fulfill({ json: { data: { assessment: null } } });
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
            projection: previewProjection(DRAFT, MEMORY),
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
  await waitForCareerShell(page);
  await page.getByRole('button', { name: 'Профиль', exact: true }).click();
  const mobile = (page.viewportSize()?.width ?? 1440) < 761;
  await expect(
    page.locator(mobile ? '.career-profile-mobile' : '.career-profile-screen-view'),
  ).toBeVisible();
}

function b441Screenshot(name: string): string {
  const directory = 'output/playwright/B441';
  mkdirSync(directory, { recursive: true });
  return join(directory, `${name}.png`);
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
async function captureS10Profile(page: Page, name: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  await mkdir(S10_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: join(S10_EVIDENCE_DIR, `${name}.png`),
    animations: 'disabled',
  });
  await captureScrollableScreen(page, S10_EVIDENCE_DIR, name, width);
  await captureCareerHarness(page, join(S10_EVIDENCE_DIR, `${name}.html`));
}

async function captureB441View(page: Page, path: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, animations: 'disabled' });
  await captureScrollableScreen(page, dirname(path), basename(path, '.png'), width);
}

const SECTION_IDS = [
  'sec-about',
  'sec-experience',
  'sec-education',
  'sec-certificates',
  'sec-projects',
  'sec-courses',
  'sec-languages',
  'sec-recommendations',
  'sec-achievements',
] as const;
const DESKTOP_RESUME_SECTION_IDS = SECTION_IDS.filter(
  (id) =>
    !['sec-certificates', 'sec-courses', 'sec-recommendations', 'sec-achievements'].includes(id),
);

test.describe('B441 Profile screen from mockup 2', () => {
  test('resume tab shows available source counts, block completeness and an honest ATS state', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1440',
      'The compact header is checked separately.',
    );
    const importedSources: ImportedSourceSummary[] = [
      {
        platform: 'linkedin',
        connectedAt: '2026-09-12T09:00:00.000Z',
        lastImportedAt: '2026-09-12T09:00:00.000Z',
        factCount: 9,
      },
      {
        platform: 'hh',
        connectedAt: '2026-10-07T09:00:00.000Z',
        lastImportedAt: '2026-10-07T09:00:00.000Z',
        factCount: 8,
      },
    ];
    await stubSession(page, importedSources);
    await openProfile(page);

    const tabs = page.getByRole('tablist', { name: 'Профиль' });
    await expect(tabs.getByRole('tab', { name: 'Резюме' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(tabs.getByRole('tab', { name: /Навыки.*24/u })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Цифровой след' })).toBeVisible();
    await expect(
      page.getByRole('progressbar', { name: 'Резюме собрано 6 из 6 блоков' }),
    ).toBeVisible();
    const profileHeader = page.locator('.career-profile-screen-topcard');
    await expect(profileHeader).toContainText('Марина Соколова');
    await expect(profileHeader).toContainText('VP of Engineering');
    await expect(profileHeader).toContainText('Берлин, Германия');
    await expect(profileHeader.getByText(/Резюме собрано 6 из 6 блоков/u)).toBeVisible();
    // The fixture has no pending facts, and the line shows only when N > 0 (block A recheck).
    await expect(profileHeader.getByText(/(ждут|ждёт) подтверждения/u)).toHaveCount(0);

    const name = profileHeader.getByRole('heading', { level: 1 });
    const role = profileHeader.getByText('VP of Engineering', { exact: false }).first();
    const location = profileHeader.getByText('Берлин, Германия', { exact: true }).first();
    const anchors = page.getByRole('navigation', { name: 'Разделы профиля' });
    if (testInfo.project.name === 'desktop-1440') {
      await expect(name).toContainText('Марина Соколова');
      await expect(name).toBeVisible();
      await expect(role).toBeVisible();
      await expect(location).toBeVisible();
      await expect(anchors.getByRole('link')).toHaveText([
        'Проверка',
        'ATS',
        'Обо мне',
        'Опыт',
        'Образование',
        'Проекты',
        'Языки',
        'Релокация',
        'Резюме и версии',
      ]);
    } else {
      await expect(anchors).toBeHidden();
    }

    const review = page.locator('#sec-check');
    await expect(review.getByRole('heading', { name: /Проверка резюме/u })).toBeVisible();
    const reviewRows = review.locator('.career-profile-screen-review-row');
    await expect(reviewRows.first()).toBeVisible();
    for (const row of await reviewRows.all()) {
      await expect(row.locator('.career-profile-screen-review-badge')).toBeVisible();
      await expect(row.locator('.career-profile-screen-review-badge')).not.toHaveText(
        /^(\d+) \1 /u,
      );
    }
    await expect(
      review.getByRole('button', { name: /Собрать факты с консультантом/u }),
    ).toBeVisible();
    await expect(review.locator('button.career-primary-button')).toHaveCount(1);
    await expect(review.getByRole('button', { name: 'Заполнить анкету', exact: true })).toHaveCount(
      0,
    );

    await expect(page.locator('.career-profile-screen-otw')).toHaveCount(0);
    const ats = page.locator('.career-profile-screen-ats-card');
    await expect(ats).toHaveAttribute('data-assessment-status', 'unknown');
    await expect(ats.getByRole('heading', { name: 'Прохождение ATS' })).toBeVisible();
    await expect(ats).toContainText('Нет подтверждённых данных для расчёта.');
    await expect(ats).not.toContainText(/\b\d+ из 100\b/u);
    for (const category of ['Структура', 'Ключевые слова', 'Даты', 'Формат']) {
      await expect(ats.getByText(category, { exact: false })).toBeVisible();
    }
    // Chips carry the brand mark and «Подключено», no counts or dates (walk 29.10, C5).
    await expect(page.getByRole('button', { name: /LinkedIn.*Подключено/u })).toBeVisible();
    await expect(page.getByRole('button', { name: /hh\.ru.*Подключено/u })).toBeVisible();
    await expect(page.getByRole('button', { name: /12\.09|07\.10/u })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /JSON/u })).toHaveCount(0);
    await expect(page.getByText('Full professional proficiency')).toHaveCount(0);
    await captureS10Profile(page, `profile-${page.viewportSize()?.width ?? 'unknown'}`);
    await captureB441View(page, b441Screenshot(`${testInfo.project.name}-resume`));

    await page.locator('#sec-documents button[aria-controls="docs-more"]').click();
    await page.locator('.career-profile-screen-ats-details summary').click();
    await expect(page.locator('.career-resume-ats-view')).toBeVisible();
    await expect(page.getByLabel('Требования вакансии')).toBeVisible();
    await captureB441View(page, b441Screenshot(`${testInfo.project.name}-ats-editor`));

    const sourceButton = page.getByRole('button', { name: /LinkedIn.*Подключено/u });
    await sourceButton.click();
    if (testInfo.project.name !== 'mobile-390') {
      // Mockup 2 «Модальное окно: источник»: the chip opens the source dialog first.
      const dialog = page.getByRole('dialog', { name: 'LinkedIn' });
      await expect(dialog).toContainText('Импортировано 9 из 9 фактов');
      await dialog.getByRole('button', { name: /Импортировать заново|Подключить/u }).click();
    }
    const account = page.getByTestId('career-shell').getByRole('main');
    if (testInfo.project.name === 'mobile-390') {
      await expect(account.locator('[data-mv="conn"]')).toBeVisible();
    } else {
      await expect(account.getByRole('tab', { name: /Подключения/u })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(account.getByRole('heading', { name: 'Площадки и каналы' })).toBeVisible();
    }
    await captureB441View(page, b441Screenshot(`${testInfo.project.name}-source-management`));
  });

  test('skills and digital footprint are real tabs, not sections mixed into the résumé', async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-390';
    await stubSession(page);
    await page.setViewportSize(
      isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    );
    await page.route('**/api/v1/candidate/skill-confirmations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            passingScorePercent: 80,
            skills: [
              {
                id: 'sk-1',
                name: 'Kafka',
                status: null,
                source: null,
                verifiedAt: null,
                quizCheckable: true,
                lastAttempt: null,
                conversation: { name: 'Kafka', state: 'not_checked', facts: [] },
              },
            ],
          },
        }),
      }),
    );
    await openProfile(page);

    const tabs = page.getByRole('tablist', { name: 'Профиль' });
    const skillsTab = isMobile
      ? tabs.getByRole('tab', { name: 'Навыки', exact: true })
      : tabs.getByRole('tab', { name: /Навыки.*24/u });
    await skillsTab.click();
    await expect(skillsTab).toHaveAttribute('aria-selected', 'true');
    if (isMobile) {
      const mobileProfile = page.locator('.career-profile-mobile');
      const skills = page.getByLabel('Все навыки профиля');
      await expect(skills.locator('.profile-mobile-skill')).toHaveCount(5);
      const showAllSkills = page.getByRole('button', { name: 'Показать все навыки' });
      await expect(showAllSkills).toHaveAttribute('aria-expanded', 'false');
      await showAllSkills.click();
      await expect(skills.locator('.profile-mobile-skill')).toHaveCount(24);
      await expect(page.getByRole('button', { name: 'Свернуть список навыков' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(mobileProfile).toHaveAttribute('data-profile-tab', 'skills');
    } else {
      await expect(page.locator('.profile-desktop-skills-stack > section')).toHaveCount(2);
      await expect(page.locator('#sec-skills')).toBeVisible();
      for (const id of [
        'sec-certificates',
        'sec-courses',
        'sec-recommendations',
        'sec-achievements',
      ]) {
        await expect(page.locator(`#${id}`)).toHaveCount(0);
      }
      const editSkills = page.getByRole('button', { name: 'Изменить навыки', exact: true });
      await expect(editSkills).toBeVisible();
      await editSkills.click();
      await expect(page.getByRole('textbox', { name: 'Новый навык', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    }
    const confirmButton = page
      .getByRole('button', { name: 'Подтвердить навык', exact: true })
      .first();
    await expect(confirmButton).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Пройти квиз/u })).toHaveCount(0);
    await expect(page.locator('#sec-about')).toHaveCount(0);
    await captureB441View(page, b441Screenshot(`${testInfo.project.name}-skills-tab`));

    await confirmButton.click();
    const confirmDialog = page.getByRole('dialog', { name: 'Подтвердить навык' });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('Проверка openqareer, не сертификат');
    await confirmDialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(confirmDialog).toHaveCount(0);
    if (!isMobile) {
      const assessmentCard = page.locator('.profile-desktop-assessment');
      await expect(assessmentCard.getByRole('heading', { name: 'Проверка навыков' })).toBeVisible();
      const startAssessment = assessmentCard.getByRole('button', { name: 'Начать', exact: true });
      await expect(startAssessment).toBeEnabled();
      await startAssessment.click();
      const roleAssessment = page.getByTestId('role-skill-assessment');
      await expect(roleAssessment).toBeVisible();
      await expect(roleAssessment.getByRole('heading', { name: 'Проверка навыков' })).toBeVisible();
      await page.getByRole('button', { name: 'Назад к профилю', exact: true }).click();
      await expect(roleAssessment).toHaveCount(0);
    }

    const returnedTabs = page.getByRole('tablist', { name: 'Профиль' });
    const returnedSkills = isMobile
      ? returnedTabs.getByRole('tab', { name: 'Навыки', exact: true })
      : returnedTabs.getByRole('tab', { name: /Навыки.*24/u });
    await returnedSkills.click();
    await returnedTabs
      .getByRole('tab', { name: isMobile ? 'След' : 'Цифровой след', exact: true })
      .click();
    await expect(
      returnedTabs.getByRole('tab', { name: isMobile ? 'След' : 'Цифровой след', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.career-footprint-surface')).toBeVisible();
    if (isMobile) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await captureB441View(page, b441Screenshot(`${testInfo.project.name}-trace-tab`));
  });

  test('one experience form edits role, company, dates, location, format and achievements', async ({
    page,
  }, testInfo) => {
    let savedDraft: typeof DRAFT | undefined;
    const createdFacts: string[] = [];
    const createdMemoryIds: string[] = [];
    const createdSourceMessageIds: string[] = [];
    const currentMemory: CandidateMemory[] = [...MEMORY];
    const currentMessages: Array<{ id: string; role: 'user'; content: string }> = [];
    const chronologyMemoryId = 'manual-chronology-exp-1';
    const chronologySourceMessageId = `manual-source-${chronologyMemoryId}`;
    await stubSession(page);
    await page.route('**/api/v1/candidate/me**', async (route) =>
      route.fulfill({
        json: {
          data: {
            ...SNAPSHOT,
            memory: currentMemory,
            messages: [...SNAPSHOT.messages, ...currentMessages],
          },
        },
      }),
    );
    await page.route('**/api/v1/candidate/resume', async (route) => {
      if (route.request().method() === 'PUT') {
        const incoming = route.request().postDataJSON() as typeof DRAFT;
        const previousExperience = (savedDraft ?? DRAFT).experience.find(
          (entry) => entry.id === 'exp-1',
        );
        const experience = incoming.experience.find((entry) => entry.id === 'exp-1');
        if (experience) {
          const statement = manualExperienceStatement(experience);
          const fieldsChanged =
            !previousExperience || manualExperienceStatement(previousExperience) !== statement;
          const nextChronologyMemoryId = fieldsChanged
            ? chronologyMemoryId
            : (previousExperience.chronologyMemoryId ?? experience.chronologyMemoryId);
          if (fieldsChanged && !currentMemory.some((item) => item.id === chronologyMemoryId)) {
            currentMemory.push(fact(chronologyMemoryId, statement, [chronologySourceMessageId]));
            currentMessages.push({
              id: chronologySourceMessageId,
              role: 'user',
              content: statement,
            });
          }
          savedDraft = {
            ...incoming,
            experience: incoming.experience.map((entry) =>
              entry.id === 'exp-1'
                ? { ...entry, chronologyMemoryId: nextChronologyMemoryId }
                : entry,
            ),
          };
        } else {
          savedDraft = incoming;
        }
      }
      return route.fulfill({
        json: {
          data: {
            draft: savedDraft ?? DRAFT,
            savedAt: {
              createdAt: '2026-10-09T00:00:00.000Z',
              updatedAt: '2026-10-09T00:00:00.000Z',
            },
            projection: previewProjection(savedDraft ?? DRAFT, currentMemory),
            evidenceFreshness: { stale: [] },
          },
        },
      });
    });
    await page.route('**/api/v1/candidate/experience-facts', async (route) => {
      const body = route.request().postDataJSON() as { statement: string };
      const id = String(route.request().headers()['idempotency-key']);
      const sourceMessageId = `manual-source-${id}`;
      const memory = fact(id, body.statement, [sourceMessageId]);
      createdFacts.push(body.statement);
      createdMemoryIds.push(id);
      createdSourceMessageIds.push(sourceMessageId);
      currentMemory.push(memory);
      currentMessages.push({ id: sourceMessageId, role: 'user', content: body.statement });
      return route.fulfill({ json: { data: { memory } } });
    });
    const assertProjectedDescription = () => {
      const projection = previewProjection(savedDraft ?? DRAFT, currentMemory);
      const description = projection.master?.experience.find(
        (entry) => entry.id === 'exp-1',
      )?.description;
      expect(description).toMatchObject({
        value: 'Построила платформу обработки платежей.',
        memoryId: createdMemoryIds[0],
        sourceMessageIds: [createdSourceMessageIds[0]],
        reviewFlags: expect.any(Array),
      });
      expect(currentMessages).toContainEqual({
        id: createdSourceMessageIds[0],
        role: 'user',
        content: 'Построила платформу обработки платежей.',
      });
      expect(
        currentMemory.find((item) => item.id === chronologyMemoryId)?.sourceMessageIds,
      ).toEqual([chronologySourceMessageId]);
      expect(currentMessages).toContainEqual({
        id: chronologySourceMessageId,
        role: 'user',
        content: manualExperienceStatement(
          savedDraft?.experience.find((entry) => entry.id === 'exp-1') ?? DRAFT.experience[0]!,
        ),
      });
    };
    await openProfile(page);

    if (testInfo.project.name === 'mobile-390') {
      const mobileProfile = page.locator('.career-profile-mobile');
      await mobileProfile
        .locator('.pm-row')
        .filter({ has: page.getByText('Опыт', { exact: true }) })
        .click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'exp');
      await mobileProfile
        .locator('.pm-row')
        .filter({ has: page.getByText('FinNova Bank', { exact: true }) })
        .first()
        .click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'job');
      await page.getByRole('button', { name: 'Изменить место', exact: true }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'jobedit');

      const form = mobileProfile.locator('.profile-mobile-position-editor');
      await expect(form.getByLabel('Должность')).toBeVisible();
      await expect(form.getByLabel('Компания')).toBeVisible();
      const start = form.getByLabel('Начало');
      await expect(start).toHaveAttribute('name', 'startDate');
      await expect
        .poll(() => start.evaluate((input) => (input as HTMLInputElement).type))
        .toBe('text');
      await expect(start).toHaveAttribute('placeholder', 'ММ.ГГГГ');
      await expect(start).toHaveAttribute('pattern', '(0[1-9]|1[0-2])\\.[0-9]{4}');
      await expect(form.getByRole('heading', { name: 'Навыки на этом месте' })).toBeVisible();
      await expect(form.getByText('Kubernetes', { exact: true })).toBeVisible();
      const existingAchievementText = MEMORY[0]!.statement;
      await expect(form.getByText(existingAchievementText, { exact: true })).toBeVisible();
      await expect(
        form.getByRole('button', {
          name: `Удалить достижение: ${existingAchievementText}`,
          exact: true,
        }),
      ).toBeVisible();
      const workplace = form.getByRole('radiogroup', { name: 'Формат работы' });
      await expect(workplace.getByRole('radio', { name: 'Гибрид' })).toHaveAttribute(
        'aria-checked',
        'true',
      );

      await form.getByLabel('Должность').fill('VP of Payments');
      await form.getByLabel('Компания').fill('FinNova Payments');
      await form.getByLabel('Локация').fill('Берлин');
      await start.fill('02.2023');
      await form.getByText('Работаю здесь сейчас', { exact: true }).click();
      const currentRole = form.getByRole('checkbox', { name: 'Работаю здесь сейчас' });
      await expect(currentRole).not.toBeChecked();
      const end = form.getByLabel('Окончание');
      await expect(end).toHaveAttribute('name', 'endDate');
      await end.fill('02.2024');
      await workplace.getByRole('radio', { name: 'Удалённо' }).click();
      await expect(workplace.getByRole('radio', { name: 'Удалённо' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await form.getByLabel('Описание').fill('Построила платформу обработки платежей.');
      await form.getByRole('button', { name: 'Добавить достижение', exact: true }).click();
      await form
        .getByRole('textbox', { name: 'Новое достижение 1', exact: true })
        .fill('Сократила время выпуска релиза с трёх недель до двух дней.');
      await form.getByRole('button', { name: 'Сохранить', exact: true }).click();

      await expect.poll(() => savedDraft).toBeDefined();
      await expect.poll(() => createdFacts).toHaveLength(2);
      await expect
        .poll(
          () =>
            (savedDraft?.experience as Array<Record<string, unknown>> | undefined)?.find(
              (entry) => entry.id === 'exp-1',
            )?.descriptionMemoryId,
        )
        .toBe(createdMemoryIds[0]);
      const mobileExperience = (
        savedDraft?.experience as Array<Record<string, unknown>> | undefined
      )?.find((entry) => entry.id === 'exp-1');
      expect(mobileExperience).toMatchObject({
        title: 'VP of Payments',
        employer: 'FinNova Payments',
        location: 'Берлин',
        employmentType: 'Полная занятость',
        startDate: '2023-02',
        endDate: '2024-02',
        current: false,
        workplaceType: 'remote',
        chronologyMemoryId,
        descriptionMemoryId: createdMemoryIds[0],
        skills: ['Platform Strategy', 'Kubernetes', 'Team Scaling', 'Fintech Compliance'],
      });
      expect(mobileExperience?.bulletMemoryIds).toContain(createdMemoryIds[1]);
      expect(currentMemory.find((item) => item.id === createdMemoryIds[0])?.statement).toBe(
        'Построила платформу обработки платежей.',
      );
      expect(createdFacts).toEqual([
        'Построила платформу обработки платежей.',
        'Сократила время выпуска релиза с трёх недель до двух дней.',
      ]);
      assertProjectedDescription();
      await expect(mobileProfile).toContainText('FinNova Payments');
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'job');
      await captureB441View(page, b441Screenshot(`${testInfo.project.name}-experience-saved`));

      const memoryResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/candidate/me' &&
          response.request().method() === 'GET',
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForCareerShell(page);
      const reloadedMemory = (await (await memoryResponse).json()) as {
        data: {
          memory: CandidateMemory[];
          messages: Array<{ id: string; role: 'user'; content: string }>;
        };
      };
      expect(reloadedMemory.data.memory).toContainEqual(
        expect.objectContaining({
          id: createdMemoryIds[0],
          statement: 'Построила платформу обработки платежей.',
          sourceMessageIds: [createdSourceMessageIds[0]],
        }),
      );
      expect(reloadedMemory.data.messages).toContainEqual({
        id: createdSourceMessageIds[0],
        role: 'user',
        content: 'Построила платформу обработки платежей.',
      });
      await page.getByRole('button', { name: 'Профиль', exact: true }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'home');
      await mobileProfile
        .locator('.pm-row')
        .filter({ has: page.getByText('Опыт', { exact: true }) })
        .click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'exp');
      await mobileProfile
        .locator('.pm-row')
        .filter({ has: page.getByText('FinNova Payments', { exact: true }) })
        .click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'job');
      await expect(mobileProfile).toContainText(
        'Сократила время выпуска релиза с трёх недель до двух дней.',
      );
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'exp');
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'home');
      await mobileProfile
        .locator('.pm-row')
        .filter({ has: page.getByText('Версии под вакансии', { exact: true }) })
        .click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'docs');
      await page.emulateMedia({ media: 'print' });
      const printedResume = page.locator('.career-resume-print');
      await expect(printedResume).toBeVisible();
      await expect(printedResume).toContainText('Построила платформу обработки платежей.');
      await page.emulateMedia({ media: 'screen' });
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'home');
      await mobileProfile
        .locator('.pm-row')
        .filter({ has: page.getByText('Опыт', { exact: true }) })
        .click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'exp');
      await mobileProfile.locator('.pm-row').filter({ hasText: 'Добавить место работы' }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'jobadd');
      await expect(mobileProfile.locator('.profile-mobile-position-editor')).toBeVisible();
      await captureB441View(page, b441Screenshot(`${testInfo.project.name}-experience-add`));
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'exp');
    } else {
      const experience = page.locator('#sec-experience');
      await experience
        .getByRole('button', { name: 'Редактировать место целиком: FinNova Bank' })
        .first()
        .click();
      const form = experience.locator('.career-profile-screen-place-editor');
      await expect(form.getByLabel('Должность')).toBeVisible();
      await expect(form.getByLabel('Компания')).toBeVisible();
      await expect(form.getByLabel('Начало')).toHaveAttribute('type', 'month');
      await expect(form.getByLabel('Окончание')).toHaveAttribute('type', 'month');
      await expect(form.getByLabel('Локация')).toHaveValue('Берлин, Германия');
      const workplace = form.getByRole('group', { name: 'Формат работы' });
      const hybridOption = workplace.getByRole('button', { name: 'Гибрид', exact: true });
      await expect(hybridOption).toHaveAttribute('aria-pressed', 'true');
      await expect(form.getByRole('group', { name: 'Достижения', exact: true })).toBeVisible();
      const existingAchievementText = MEMORY[0]!.statement;
      const existingAchievement = form.getByRole('textbox', {
        name: `Достижение: ${existingAchievementText}`,
        exact: true,
      });
      await expect(existingAchievement).toHaveValue(existingAchievementText);
      await form
        .getByRole('button', {
          name: `Убрать достижение: ${existingAchievementText}`,
          exact: true,
        })
        .click();
      const restoreAchievement = form.getByRole('button', {
        name: `Вернуть достижение: ${existingAchievementText}`,
        exact: true,
      });
      await expect(restoreAchievement).toBeVisible();
      await restoreAchievement.click();
      await expect(existingAchievement).toHaveValue(existingAchievementText);
      await form.getByLabel('Должность').fill('VP of Payments');
      await form.getByLabel('Компания').fill('FinNova Payments');
      await form.getByLabel('Локация').fill('Берлин');
      await form.getByLabel('Начало').fill('2023-02');
      await form.getByLabel('Работаю здесь').uncheck();
      await form.getByLabel('Окончание').fill('2024-02');
      const remoteOption = workplace.getByRole('button', { name: 'Удалённо', exact: true });
      await remoteOption.click();
      await expect(remoteOption).toHaveAttribute('aria-pressed', 'true');
      await form.getByLabel('Описание').fill('Построила платформу обработки платежей.');
      await form
        .getByRole('textbox', { name: 'Достижение 1', exact: true })
        .fill('Сократила время выпуска релиза с трёх недель до двух дней.');
      await form.getByRole('button', { name: 'Сохранить место' }).click();
      await expect.poll(() => savedDraft).toBeDefined();
      await expect.poll(() => createdFacts).toHaveLength(2);
      await expect
        .poll(
          () =>
            (savedDraft?.experience as Array<Record<string, unknown>> | undefined)?.find(
              (entry) => entry.id === 'exp-1',
            )?.descriptionMemoryId,
        )
        .toBe(createdMemoryIds[0]);
      const savedExperience = (
        savedDraft?.experience as Array<Record<string, unknown>> | undefined
      )?.find((entry) => entry.id === 'exp-1');
      expect(savedExperience).toMatchObject({
        title: 'VP of Payments',
        employer: 'FinNova Payments',
        location: 'Берлин',
        employmentType: 'Полная занятость',
        startDate: '2023-02',
        endDate: '2024-02',
        current: false,
        workplaceType: 'remote',
        chronologyMemoryId,
        descriptionMemoryId: createdMemoryIds[0],
      });
      expect(savedExperience?.bulletMemoryIds).toContain(createdMemoryIds[1]);
      expect(currentMemory.find((item) => item.id === createdMemoryIds[0])?.statement).toBe(
        'Построила платформу обработки платежей.',
      );
      expect(createdFacts).toEqual([
        'Построила платформу обработки платежей.',
        'Сократила время выпуска релиза с трёх недель до двух дней.',
      ]);
      assertProjectedDescription();
      await expect(experience).toContainText('FinNova Payments');
      await expect(
        experience.getByRole('button', { name: /Редактировать место целиком/u }),
      ).toHaveCount(3);
      await experience.scrollIntoViewIfNeeded();
      await captureB441View(page, b441Screenshot(`${testInfo.project.name}-experience-saved`));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForCareerShell(page);
      await page.getByRole('button', { name: 'Профиль', exact: true }).click();
      await expect(experience).toContainText('FinNova Payments');
      await page.emulateMedia({ media: 'print' });
      const printedResume = page.locator('.career-resume-print');
      await expect(printedResume).toBeVisible();
      await expect(printedResume).toContainText('Построила платформу обработки платежей.');
      await page.emulateMedia({ media: 'screen' });
      await experience.getByRole('button', { name: 'Добавить место работы' }).click();
      const addForm = experience.locator('.career-profile-screen-place-editor');
      await expect(addForm).toBeVisible();
      await addForm.scrollIntoViewIfNeeded();
      await captureB441View(page, b441Screenshot(`${testInfo.project.name}-experience-add`));
      await experience.getByRole('button', { name: 'Отменить' }).click();
    }
  });

  test('1440×900 keeps Profile content full-height with the consultant expanded', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'This verifies the desktop shell layout.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubSession(page);
    await openProfile(page);

    const consultant = page.locator('.career-expert-panel');
    await expect(consultant).toBeVisible();
    const expand = consultant.getByRole('button', { name: /Развернуть консультанта/u });
    if (await expand.count()) await expand.click();
    await expect(consultant).not.toHaveClass(/consultant-strip/u);
    await expect(consultant).toHaveAttribute('role', 'complementary');
    expect(await consultant.getAttribute('aria-modal')).toBeNull();

    const main = page.locator('.career-main');
    await expect.poll(async () => Math.round((await main.boundingBox())?.height ?? 0)).toBe(900);
    await expect(page.locator('.career-consultant-backdrop')).toBeHidden();
  });

  test('1176×900 keeps Profile editing reachable beside an open consultant', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1440',
      'This verifies an intermediate desktop width.',
    );
    await page.setViewportSize({ width: 1176, height: 900 });
    await stubSession(page);
    await openProfile(page);
    const experienceNavigation = page
      .getByRole('navigation', { name: 'Разделы профиля' })
      .getByRole('link', { name: 'Опыт', exact: true });
    await experienceNavigation.click();
    const experience = page.locator('#sec-experience');
    await expect(experience).toBeVisible();

    const consultant = page.locator('.career-expert-panel');
    await expect(consultant).toBeVisible();
    await expect(consultant).toHaveAttribute('role', 'complementary');
    expect(await consultant.getAttribute('aria-modal')).toBeNull();

    const edit = experience
      .getByRole('button', { name: 'Редактировать место целиком: FinNova Bank' })
      .first();
    await edit.click();
    const form = experience.locator('.career-profile-screen-place-editor');
    await expect(form).toBeVisible();
    const title = form.getByLabel('Должность');
    await expect(title).toHaveValue('VP of Engineering');
    await title.fill('VP of Payments');
    await expect(title).toHaveValue('VP of Payments');
    await form.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(experience).toContainText('VP of Engineering');

    await closeConsultant(page);
    await expect(experience).toBeVisible();
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 806 },
  ]) {
    test(`${viewport.width}: the pinned section nav stays below the topbar and clears the heading`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'desktop-1440',
        'This verifies the desktop shell layout.',
      );
      await page.setViewportSize(viewport);
      await stubSession(page);
      await openProfile(page);
      const nav = page.getByRole('navigation', { name: 'Разделы профиля' });
      await nav.getByRole('link', { name: 'Опыт', exact: true }).click();
      await expect(page.locator('#sec-experience')).toBeInViewport();

      // Block A 30.10: the nav stuck at top 0 under the 64 px topbar, so its links were hidden.
      const layout = await page.evaluate(() => {
        const topbar = document.querySelector('.career-desktop-topbar')!.getBoundingClientRect();
        const navBox = document.querySelector('.career-profile-screen-anchor-nav')!;
        const links = [...navBox.querySelectorAll('a')].map((link) => {
          const box = link.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return link.contains(hit);
        });
        const heading = document.querySelector('#sec-experience-title')!.getBoundingClientRect();
        return {
          topbarBottom: topbar.bottom,
          navTop: navBox.getBoundingClientRect().top,
          navBottom: navBox.getBoundingClientRect().bottom,
          headingTop: heading.top,
          linksVisible: links,
        };
      });
      expect(layout.navTop).toBeGreaterThanOrEqual(layout.topbarBottom - 1);
      expect(layout.linksVisible.every(Boolean)).toBe(true);
      expect(layout.headingTop).toBeGreaterThanOrEqual(layout.navBottom);
    });
  }

  test('900×900 keeps the consultant below Profile content and non-modal', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1440',
      'This verifies the collapsed desktop consultant at 900 pixels.',
    );
    await page.setViewportSize({ width: 900, height: 900 });
    await stubSession(page);
    await openProfile(page);

    const consultant = page.locator('.career-expert-panel');
    const strip = page.locator('.career-expert-panel.consultant-strip');
    await expect(strip).toBeVisible();
    const stripRect = await strip.evaluate((element) => {
      const { left, right, bottom, height } = element.getBoundingClientRect();
      return { left, right, bottom, height };
    });
    expect(Math.abs(stripRect.left - 76)).toBeLessThanOrEqual(1);
    expect(Math.abs(stripRect.right - 900)).toBeLessThanOrEqual(1);
    expect(Math.abs(stripRect.bottom - 900)).toBeLessThanOrEqual(1);
    expect(Math.abs(stripRect.height - 64)).toBeLessThanOrEqual(1);

    const mainRect = await page.locator('.career-main').boundingBox();
    expect(mainRect).not.toBeNull();
    expect(Math.abs(mainRect!.x - 76)).toBeLessThanOrEqual(1);
    expect(Math.abs(mainRect!.x + mainRect!.width - 900)).toBeLessThanOrEqual(1);

    await strip.getByRole('button', { name: /^Развернуть консультанта/u }).click();
    await expect(consultant).toHaveAttribute('role', 'complementary');
    expect(await consultant.getAttribute('aria-modal')).toBeNull();

    const experienceNavigation = page
      .getByRole('navigation', { name: 'Разделы профиля' })
      .getByRole('link', { name: 'Опыт', exact: true });
    await experienceNavigation.click();
    const experience = page.locator('#sec-experience');
    await expect(experience).toBeVisible();
    const edit = experience
      .getByRole('button', { name: 'Редактировать место целиком: FinNova Bank' })
      .first();
    await edit.click();
    const form = experience.locator('.career-profile-screen-place-editor');
    await expect(form).toBeVisible();
    const title = form.getByLabel('Должность');
    await title.click();
    await title.fill('VP of Payments');
    await expect(title).toHaveValue('VP of Payments');

    await closeConsultant(page);
    await expect(strip).toBeVisible();
    await form.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(experience).toContainText('VP of Engineering');
  });
});

/** Desktop keeps the preferences form in the collapsed «Релокация» block; 390 shows it open. */
async function openProfilePreferences(page: Page): Promise<void> {
  const summary = page.locator('.career-profile-screen-relocation-prefs > summary');
  if (await summary.count()) await summary.click();
}

test.describe('B265 Profile screen', () => {
  test('shows the saved reader method beside the source chip', async ({ page }, testInfo) => {
    const importedSources: ImportedSourceSummary[] = [
      {
        platform: 'linkedin',
        connectedAt: '2026-09-12T09:00:00.000Z',
        lastImportedAt: '2026-09-12T09:00:00.000Z',
        factCount: 9,
      },
      {
        platform: 'hh',
        connectedAt: '2026-10-07T09:00:00.000Z',
        lastImportedAt: '2026-10-07T09:00:00.000Z',
        factCount: 8,
      },
    ];
    await stubSession(page, importedSources);
    await page.route('**/api/v1/candidate/resume', async (route) => {
      await route.fulfill({
        json: {
          data: {
            draft: DRAFT,
            savedAt: {
              createdAt: '2026-09-21T09:00:00.000Z',
              updatedAt: '2026-09-21T09:00:00.000Z',
            },
            projection: previewProjection(DRAFT, MEMORY),
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

    const outputDir = join(process.cwd(), 'test-results', 'c67-reader-provenance');
    mkdirSync(outputDir, { recursive: true });
    if (testInfo.project.name === 'mobile-390') {
      const mobileProfile = page.locator('.career-profile-mobile');
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'home');
      const source = page.getByRole('button', { name: /^LinkedIn/u });
      await expect(source).toContainText('9 из 9');
      await source.click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'src');
      await expect(mobileProfile.getByRole('button', { name: /^LinkedIn/u })).toBeVisible();
      await expect(mobileProfile.getByRole('button', { name: /^hh/u })).toBeVisible();
      const accessibility = await new AxeBuilder({ page })
        .include('.career-profile-mobile')
        .analyze();
      expect(
        accessibility.violations.filter((violation) => violation.impact === 'critical'),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    } else {
      const row = page.locator('.career-profile-screen-status-row');
      const readerStatus = row.locator('.career-profile-screen-reader-status');
      await expect(readerStatus).toHaveText('Прочитано моделью');
      await expect(row.locator('.career-profile-screen-source-chip').first()).toBeVisible();
      await expect(page.getByText('Резюме прочитано: неизвестно', { exact: true })).toHaveCount(0);
      const accessibility = await new AxeBuilder({ page })
        .include('.career-profile-screen-view')
        .analyze();
      expect(
        accessibility.violations.filter((violation) => violation.impact === 'critical'),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }

    const width = page.viewportSize()?.width ?? 0;
    await captureB441View(page, join(outputDir, `profile-reader-${width}.png`));
    await captureCareerHarness(page, testInfo.outputPath('profile-reader-provenance.html'));
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
    writeFileSync(join(outputDir, `profile-reader-${width}.html`), snapshot);
  });

  test('shows the desktop resume sections and manages supplementary data in the profile hub', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1440',
      'The phone layout has its own section check.',
    );
    test.setTimeout(90_000);
    const importedSources: ImportedSourceSummary[] = [
      {
        platform: 'linkedin',
        connectedAt: '2026-09-12T09:00:00.000Z',
        lastImportedAt: '2026-09-12T09:00:00.000Z',
        factCount: 9,
      },
      {
        platform: 'hh',
        connectedAt: '2026-10-07T09:00:00.000Z',
        lastImportedAt: '2026-10-07T09:00:00.000Z',
        factCount: 8,
      },
    ];
    const aboutParagraph = 'Тестовый абзац для проверки раскрытия полного текста.';
    let savedDraft: typeof DRAFT = {
      ...DRAFT,
      candidate: {
        ...DRAFT.candidate,
        about: [DRAFT.candidate.about, aboutParagraph, aboutParagraph, aboutParagraph].join('\n\n'),
      },
    };
    let failNextResumeSave = false;
    await stubSession(page, importedSources);
    await page.route('**/api/v1/candidate/resume', async (route) => {
      if (route.request().method() === 'PUT') {
        if (failNextResumeSave) {
          failNextResumeSave = false;
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: 'resume_unavailable',
                message: 'Сохранение временно недоступно.',
              },
            },
          });
        }
        savedDraft = route.request().postDataJSON() as typeof DRAFT;
      }
      return route.fulfill({
        json: {
          data: {
            draft: savedDraft,
            savedAt: {
              createdAt: '2026-09-21T09:00:00.000Z',
              updatedAt: '2026-10-17T09:00:00.000Z',
            },
            projection: previewProjection(savedDraft, MEMORY),
            evidenceFreshness: { stale: [] },
          },
        },
      });
    });
    await openProfile(page);

    await expect(page.locator('.career-profile-screen-topcard')).toContainText('Марина Соколова');
    await expect(page.locator('.career-profile-screen-otw')).toHaveCount(0);
    for (const id of DESKTOP_RESUME_SECTION_IDS) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
    const skillsTab = page.getByRole('tab', { name: /Навыки/u });
    await skillsTab.click();
    await expect(page.locator('.profile-desktop-skills-stack > section')).toHaveCount(2);
    await expect(page.locator('#sec-skills')).toBeVisible();
    for (const id of [
      'sec-certificates',
      'sec-courses',
      'sec-recommendations',
      'sec-achievements',
    ]) {
      await expect(page.locator(`#${id}`)).toHaveCount(0);
    }
    await page.getByRole('tab', { name: 'Резюме', exact: true }).click();
    await openProfilePreferences(page);
    await expect(page.locator('.career-work-preferences')).toBeVisible();
    await expect(page.locator('.career-profile-screen-completion')).toBeVisible();
    await expect(page.locator('.career-profile-screen-source-chip')).toHaveCount(2);
    await expect(
      page.locator('#sec-experience .career-profile-screen-position').first(),
    ).toBeVisible();
    await expect(page.locator('.career-profile-screen-lang-source').first()).toBeVisible();
    const languages = page.locator('#sec-languages .career-profile-screen-lang-item');
    await expect(languages).toHaveCount(DRAFT.languages.length);
    await expect(languages.nth(0)).toContainText('Английский');
    await expect(languages.nth(0)).toContainText('C1');
    await expect(languages.nth(1)).toContainText('Немецкий');
    await expect(languages.nth(1)).toContainText('B2');

    const aboutText = page.locator('#sec-about .profile-about-text');
    await expect(aboutText).toHaveClass(/is-clamped/u);
    await expect(aboutText).toContainText(aboutParagraph);
    await expect(aboutText).toContainText('Строю инженерную стратегию и roadmap');
    const clampedAboutBox = await aboutText.boundingBox();
    expect(clampedAboutBox).not.toBeNull();
    await page.getByRole('button', { name: 'Показать полностью', exact: true }).click();
    await expect(aboutText).not.toHaveClass(/is-clamped/u);
    await expect(aboutText).toContainText(aboutParagraph);
    await expect(aboutText).toContainText('Строю инженерную стратегию и roadmap');
    const expandedAboutBox = await aboutText.boundingBox();
    expect(expandedAboutBox).not.toBeNull();
    expect(expandedAboutBox!.height).toBeGreaterThan(clampedAboutBox!.height);
    await page.getByRole('button', { name: 'Свернуть', exact: true }).click();
    await expect(aboutText).toHaveClass(/is-clamped/u);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await captureB441View(page, 'output/playwright/C74/profile-1440.png');
    await captureB441View(page, 'output/playwright/B265/profile-1440.png');
    await captureS10Profile(page, 'profile-1440');
    await captureB441View(page, testInfo.outputPath('profile-1440.png'));

    const profileDataDialog = page.getByRole('dialog');
    await page
      .getByRole('button', { name: 'Изменить основные данные профиля', exact: true })
      .click();
    await expect(profileDataDialog).toBeVisible();
    await expect(profileDataDialog.locator('#profile-data-dialog-title')).toBeVisible();
    await expect(profileDataDialog.getByLabel('Имя', { exact: true })).toBeFocused();
    await expect(profileDataDialog.getByLabel('Email', { exact: true })).toHaveValue(
      'm.sokolova@example.com',
    );
    await page.keyboard.press('Escape');
    await expect(profileDataDialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Изменить основные данные профиля', exact: true }),
    ).toBeFocused();

    await page.getByRole('button', { name: 'Открыть данные профиля', exact: true }).click();
    await expect(profileDataDialog).toBeVisible();
    await expect(profileDataDialog.getByRole('heading', { name: 'Данные профиля' })).toBeVisible();
    await expect(profileDataDialog.getByRole('button', { name: 'Имя', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(profileDataDialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Открыть данные профиля', exact: true }),
    ).toBeFocused();

    await page.getByRole('button', { name: 'Открыть данные профиля', exact: true }).click();
    await expect(profileDataDialog).toBeVisible();
    await profileDataDialog.getByRole('button', { name: 'Курсы', exact: true }).click();
    await expect(profileDataDialog.locator('#profile-data-dialog-title')).toBeVisible();
    await profileDataDialog.getByRole('button', { name: 'Добавить курс', exact: true }).click();
    await profileDataDialog
      .getByLabel('Название', { exact: true })
      .fill('Block A Reliability Course');
    await profileDataDialog.getByLabel('Организация', { exact: true }).fill('OpenQareer Academy');
    await profileDataDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => savedDraft.courses?.at(-1)?.name).toBe('Block A Reliability Course');
    const courseTile = profileDataDialog
      .locator('.career-profile-screen-tile')
      .filter({ hasText: 'Block A Reliability Course' });
    await expect(courseTile).toBeVisible();
    await courseTile.getByRole('button', { name: 'Изменить курс', exact: true }).click();
    await profileDataDialog
      .getByLabel('Название', { exact: true })
      .fill('Block A Reliability Course v2');
    await profileDataDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => savedDraft.courses?.at(-1)?.name).toBe('Block A Reliability Course v2');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(page.locator('.career-profile-screen-view')).toBeVisible();
    await page.getByRole('button', { name: 'Открыть данные профиля', exact: true }).click();
    await expect(profileDataDialog.getByRole('heading', { name: 'Данные профиля' })).toBeVisible();
    await profileDataDialog.getByRole('button', { name: 'Курсы', exact: true }).click();
    await expect(profileDataDialog).toContainText('Block A Reliability Course v2');
    await profileDataDialog
      .locator('.career-profile-screen-tile')
      .filter({ hasText: 'Block A Reliability Course v2' })
      .getByRole('button', { name: 'Удалить курс', exact: true })
      .click();
    await expect.poll(() => savedDraft.courses?.length).toBe(0);
    await expect(profileDataDialog).not.toContainText('Block A Reliability Course v2');

    await profileDataDialog.getByRole('button', { name: 'К списку данных профиля' }).click();
    await profileDataDialog.getByRole('button', { name: 'Сертификаты', exact: true }).click();
    await expect(profileDataDialog.locator('#profile-data-dialog-title')).toBeVisible();
    await profileDataDialog
      .getByRole('button', { name: 'Добавить сертификат', exact: true })
      .click();
    await profileDataDialog
      .getByLabel('Название', { exact: true })
      .fill('Block A Cloud Certificate');
    await profileDataDialog
      .getByLabel('Кто выдал', { exact: true })
      .fill('Cloud Native Computing Foundation');
    await profileDataDialog.getByLabel('Дата выдачи', { exact: true }).fill('окт 2026');
    await profileDataDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect
      .poll(() => savedDraft.certifications?.at(-1)?.name)
      .toBe('Block A Cloud Certificate');
    const certificateTile = profileDataDialog
      .locator('.career-profile-screen-tile')
      .filter({ hasText: 'Block A Cloud Certificate' });
    await expect(certificateTile).toBeVisible();
    await certificateTile.getByRole('button', { name: 'Изменить сертификат', exact: true }).click();
    await profileDataDialog
      .getByLabel('Название', { exact: true })
      .fill('Block A Cloud Certificate v2');
    await profileDataDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect
      .poll(() => savedDraft.certifications?.at(-1)?.name)
      .toBe('Block A Cloud Certificate v2');
    await profileDataDialog
      .locator('.career-profile-screen-tile')
      .filter({ hasText: 'Block A Cloud Certificate v2' })
      .getByRole('button', { name: 'Удалить сертификат', exact: true })
      .click();
    await expect.poll(() => savedDraft.certifications?.length).toBe(DRAFT.certifications.length);

    await profileDataDialog.getByRole('button', { name: 'К списку данных профиля' }).click();
    await profileDataDialog.getByRole('button', { name: 'Рекомендации', exact: true }).click();
    await expect(profileDataDialog.locator('#profile-data-dialog-title')).toBeVisible();
    await profileDataDialog
      .getByRole('button', { name: 'Добавить рекомендацию', exact: true })
      .click();
    await profileDataDialog.getByLabel('Автор', { exact: true }).fill('Block A Peer');
    await profileDataDialog.getByLabel('Компания', { exact: true }).fill('OpenQareer Academy');
    await profileDataDialog
      .getByLabel('Должность автора', { exact: true })
      .fill('Engineering Lead');
    await profileDataDialog
      .getByRole('textbox', { name: 'Текст рекомендации', exact: true })
      .fill('Собрала надёжную платформу и помогла команде расти.');
    await profileDataDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => savedDraft.recommendations?.at(-1)?.recommender).toBe('Block A Peer');
    const recommendation = profileDataDialog
      .locator('.career-profile-screen-rec')
      .filter({ hasText: 'Block A Peer' });
    await expect(recommendation).toBeVisible();
    await recommendation
      .getByRole('button', { name: 'Изменить рекомендацию', exact: true })
      .click();
    await profileDataDialog
      .getByRole('textbox', { name: 'Текст рекомендации', exact: true })
      .fill('Обновлённая проверяемая рекомендация.');
    await profileDataDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect
      .poll(() => savedDraft.recommendations?.at(-1)?.text)
      .toBe('Обновлённая проверяемая рекомендация.');
    const recommendationsBeforeRejectedDelete = [...(savedDraft.recommendations ?? [])];
    failNextResumeSave = true;
    await recommendation.getByRole('button', { name: 'Удалить рекомендацию', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /^Не сохранилось/u })).toBeVisible();
    await expect(recommendation).toBeVisible();
    await expect(recommendation).toContainText('Обновлённая проверяемая рекомендация.');
    await expect
      .poll(() => savedDraft.recommendations)
      .toEqual(recommendationsBeforeRejectedDelete);

    await recommendation.getByRole('button', { name: 'Удалить рекомендацию', exact: true }).click();
    await expect.poll(() => savedDraft.recommendations?.length).toBe(DRAFT.recommendations.length);

    await profileDataDialog.getByRole('button', { name: 'К списку данных профиля' }).click();
    await profileDataDialog.getByRole('button', { name: 'Достижения', exact: true }).click();
    await expect(profileDataDialog.locator('#profile-data-dialog-title')).toBeVisible();
    await profileDataDialog
      .getByRole('button', { name: 'Добавить достижение', exact: true })
      .click();
    await profileDataDialog.getByLabel('Название', { exact: true }).fill('Block A Platform Award');
    await profileDataDialog
      .getByLabel('Кто выдал / где опубликовано', { exact: true })
      .fill('Engineering Journal');
    await profileDataDialog.getByLabel('Дата', { exact: true }).fill('2026');
    await profileDataDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.poll(() => savedDraft.achievements?.at(-1)?.title).toBe('Block A Platform Award');
    const achievement = profileDataDialog
      .locator('.career-profile-screen-achv-item')
      .filter({ hasText: 'Block A Platform Award' });
    await expect(achievement).toBeVisible();
    await achievement.getByRole('button', { name: 'Изменить достижение', exact: true }).click();
    await profileDataDialog
      .getByLabel('Название', { exact: true })
      .fill('Block A Platform Award v2');
    await profileDataDialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect
      .poll(() => savedDraft.achievements?.at(-1)?.title)
      .toBe('Block A Platform Award v2');
    await profileDataDialog
      .locator('.career-profile-screen-achv-item')
      .filter({ hasText: 'Block A Platform Award v2' })
      .getByRole('button', { name: 'Удалить достижение', exact: true })
      .click();
    await expect.poll(() => savedDraft.achievements?.length).toBe(DRAFT.achievements.length);
    await profileDataDialog.getByRole('button', { name: 'Закрыть данные профиля' }).click();

    const accessibility = await new AxeBuilder({ page })
      .include('.career-profile-screen-view')
      .analyze();
    expect(accessibility.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });

  test('shows every section with no horizontal scroll, phone 390', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubSession(page, [
      {
        platform: 'linkedin',
        connectedAt: '2026-09-12T09:00:00.000Z',
        lastImportedAt: '2026-09-12T09:00:00.000Z',
        factCount: 9,
      },
      {
        platform: 'hh',
        connectedAt: '2026-10-07T09:00:00.000Z',
        lastImportedAt: '2026-10-07T09:00:00.000Z',
        factCount: 8,
      },
    ]);
    await openProfile(page);

    const mobileProfile = page.locator('.career-profile-mobile');
    const openRow = (label: string) =>
      mobileProfile.locator('.pm-row').filter({ has: page.getByText(label, { exact: true }) });
    const assertMobilePage = async (route: string) => {
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', route);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    };
    const returnToHome = async () => {
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      await assertMobilePage('home');
    };

    await assertMobilePage('home');
    const nameHeading = page.locator('.pm-id h2');
    await expect(nameHeading).toHaveText('Марина Соколова');
    const nameBox = await nameHeading.boundingBox();
    expect(nameBox).not.toBeNull();
    expect(nameBox!.y).toBeLessThan(844);
    const tabs = page.getByRole('tablist', { name: 'Профиль' });
    await expect(tabs.getByRole('tab', { name: 'Резюме', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(tabs.getByRole('tab', { name: 'Навыки', exact: true })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'След', exact: true })).toBeVisible();
    await captureB441View(page, 'output/playwright/C74/profile-390.png');
    await captureB441View(page, 'output/playwright/B265/profile-390.png');
    await captureS10Profile(page, 'profile-390');
    await captureB441View(page, testInfo.outputPath('profile-390.png'));

    for (const [label, route] of [
      ['Обо мне', 'about'],
      ['Образование', 'edu'],
      ['Проекты', 'proj'],
      ['Языки', 'lang'],
      ['Релокация', 'reloc'],
      ['Прохождение ATS', 'ats'],
      ['Проверка', 'check'],
      ['Версии под вакансии', 'docs'],
    ] as const) {
      await openRow(label).click();
      await assertMobilePage(route);
      if (route === 'about') {
        await page.getByRole('button', { name: 'Изменить текст', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Обо мне', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'Отменить', exact: true }).click();
      }
      await returnToHome();
    }

    await page.getByRole('button', { name: /^LinkedIn/u }).click();
    await assertMobilePage('src');
    await returnToHome();

    await openRow('Опыт').click();
    await assertMobilePage('exp');
    await mobileProfile.locator('.pm-row').filter({ hasText: 'Добавить место работы' }).click();
    await assertMobilePage('jobadd');
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await assertMobilePage('exp');
    await mobileProfile
      .locator('.pm-row')
      .filter({ has: page.getByText('FinNova Bank', { exact: true }) })
      .first()
      .click();
    await assertMobilePage('job');
    await page.getByRole('button', { name: 'Изменить место', exact: true }).click();
    await assertMobilePage('jobedit');
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await assertMobilePage('job');
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await assertMobilePage('exp');
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await assertMobilePage('home');

    await tabs.getByRole('tab', { name: 'Навыки', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'Навыки', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const skills = page.getByLabel('Все навыки профиля');
    await expect(skills.locator('.profile-mobile-skill')).toHaveCount(5);
    const showAllSkills = page.getByRole('button', { name: 'Показать все навыки' });
    await expect(showAllSkills).toHaveAttribute('aria-expanded', 'false');
    await showAllSkills.click();
    await expect(skills.locator('.profile-mobile-skill')).toHaveCount(24);
    await expect(page.getByRole('button', { name: 'Свернуть список навыков' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.getByRole('button', { name: 'Добавить навык', exact: true }).click();
    await assertMobilePage('skilladd');
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await assertMobilePage('home');
    await tabs.getByRole('tab', { name: 'След', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'След', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.career-footprint-surface')).toBeVisible();
    await captureB441View(page, 'output/playwright/B265/profile-390-trace.png');
  });

  test('keeps profile preferences available and removes the old open-to-work banner', async ({
    page,
  }, testInfo) => {
    await stubSession(page);
    await openProfile(page);
    await expect(page.locator('.career-profile-screen-otw')).toHaveCount(0);
    if (testInfo.project.name === 'mobile-390') {
      // Contacts hold only contacts (walk 29.10, A9); preferences live on the relocation page.
      const mobileProfile = page.locator('.career-profile-mobile');
      await mobileProfile.getByRole('button', { name: /^Релокация/u }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'reloc');
      await openProfilePreferences(page);
    } else {
      await openProfilePreferences(page);
    }
    await expect(page.locator('.career-work-preferences')).toBeVisible();
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
            profileRevisionReverted: true,
          },
        },
      });
    });

    await openProfile(page);
    if (testInfo.project.name === 'mobile-390') {
      await page
        .locator('.career-profile-mobile .pm-row')
        .filter({ has: page.getByText('Обо мне', { exact: true }) })
        .click();
      await expect(page.locator('.career-profile-mobile')).toHaveAttribute(
        'data-mobile-profile-page',
        'about',
      );
    }

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
    await expect(suggestion).toContainText('Правка принята');
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
    await suggestion.getByRole('button', { name: 'Отменить правку' }).click();
    await expect.poll(() => revertedCommandId).toBe('cmd-revise-about-1');
    await expect(suggestion).toHaveCount(0);
  });

  test('C58: a grounded consultant proposal is prepared before it appears in the Profile', async ({
    page,
  }, testInfo) => {
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
    const isMobile = testInfo.project.name === 'mobile-390';
    const mobileProfile = page.locator('.career-profile-mobile');
    if (isMobile) {
      await mobileProfile
        .locator('.pm-row')
        .filter({ has: page.getByText('Проверка', { exact: true }) })
        .click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'check');
      await page
        .getByRole('button', { name: 'Собрать факты с консультантом', exact: true })
        .click();
    } else {
      const headerAsk = page.locator('button:has-text("Спросить консультанта"):visible').first();
      if (await headerAsk.isVisible()) {
        await headerAsk.click();
      } else {
        await page.getByRole('button', { name: 'Собрать факты с консультантом' }).click();
      }
    }
    const expert = page.locator('.career-expert-panel');
    await expert
      .getByLabel('Сообщение карьерному консультанту')
      .fill('Обнови раздел «Обо мне» по фактам профиля.');
    await expert.getByRole('button', { name: 'Отправить вопрос' }).click();
    await expert.getByRole('button', { name: 'Подготовить правку для Профиля' }).click();
    await expect.poll(() => preparedBody).toMatchObject({ proposalIndex: 0 });
    expect(turnIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(preparedBody).not.toHaveProperty('executionTarget');

    await closeConsultant(page);
    if (isMobile) {
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'check');
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'home');
      await mobileProfile
        .locator('.pm-row')
        .filter({ has: page.getByText('Обо мне', { exact: true }) })
        .click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'about');
    }
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
    // B549 / макет 4: на 390 вакансия открыта push-экраном, а не панелью в строке.
    await page
      .locator(testInfo.project.name === 'mobile-390' ? '.vacancy-push' : '.vacancies-detail-panel')
      .getByRole('button', { name: /Добавить .* в профиль/u })
      .click();

    const isMobile = testInfo.project.name === 'mobile-390';
    const mobileProfile = page.locator('.career-profile-mobile');
    if (isMobile) {
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'exp');
      await expect(mobileProfile.locator('.career-vacancy-requirement-assistant')).toContainText(
        requirement,
      );
    } else {
      await expect(page.locator('#sec-experience')).toBeVisible();
    }
    await expect.poll(() => turnContent).toContain(requirement);
    const suggestionRow = page.locator(`[data-suggestion-id="${commandId}"]`);
    const suggestion = page
      .locator('.profile-experience-suggestions')
      .filter({ has: suggestionRow });
    await expect(suggestion).toHaveAttribute('role', 'region');
    await expect(suggestionRow).toBeVisible();
    await expect(suggestionRow).toContainText(currentText);
    await expect(suggestionRow).toContainText(proposedText);
    expect(turnIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    await expect.poll(() => preparedBody).toMatchObject({ proposalIndex: 0 });
    expect(preparedBody).not.toHaveProperty('executionTarget');
    const accessibility = await new AxeBuilder({ page })
      .include(isMobile ? '.career-profile-mobile' : '#sec-experience')
      .analyze();
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
    await expect.poll(() => accepted).toBe(true);
    await expect(suggestionRow.getByRole('status')).toContainText('Правка принята');
    await expect.poll(() => matchedReadsAfterAccept).toBeGreaterThan(0);
    await page.locator('button[aria-label="Вакансии"]:visible').first().click();
    const reopenedToggle = page
      .locator('.vac-list-item')
      .first()
      .locator('button[aria-expanded]')
      .first();
    if ((await reopenedToggle.getAttribute('aria-expanded')) !== 'true')
      await reopenedToggle.click();
    const requirements = page.locator('.vacancies-screen-requirements');
    await expect(requirements.locator('.vacancies-screen-skill-chip.is-confirmed')).toContainText(
      requirement,
    );
    await expect(requirements.locator('.vacancies-screen-skill-chip.is-unconfirmed')).toHaveCount(
      0,
    );
  });

  test('does not show the old search-consent badge in Profile', async ({ page }) => {
    await stubSession(page);
    await openProfile(page);
    await expect(page.locator('.career-profile-screen-search-consent')).toHaveCount(0);
    await expect(page.getByText('Вы в поиске', { exact: true })).toHaveCount(0);
  });

  test('B441: master resume and saved targeted snapshots are stated honestly', async ({
    page,
  }, testInfo) => {
    await stubSession(page);
    await page.route('**/api/v1/candidate/resume/versions**', async (route) =>
      route.fulfill({
        json: {
          data: {
            items: [],
            nextCursor: null,
            totalCount: 0,
            currentMasterRevision: 'master-revision-empty',
          },
        },
      }),
    );
    await page.route('**/api/v1/candidate/resume/ats-assessment', async (route) =>
      route.fulfill({
        json: {
          data: {
            assessment: {
              total: { score: null, maximum: 100, status: 'partial' },
              dimensions: {
                structure: {
                  score: null,
                  maximum: 25,
                  status: 'unknown',
                  source: 'Источник отсутствует',
                  sampleSize: 0,
                  summary: 'Нет данных',
                },
                keywords: {
                  score: null,
                  maximum: 30,
                  status: 'unknown',
                  source: 'Нет проверенных требований вакансии',
                  sampleSize: 0,
                  summary: 'Добавьте требования вакансии с указанным источником.',
                },
                dates: {
                  score: null,
                  maximum: 20,
                  status: 'unknown',
                  source: 'Источник отсутствует',
                  sampleSize: 0,
                  summary: 'Нет данных',
                },
                format: {
                  score: null,
                  maximum: 25,
                  status: 'unknown',
                  source: 'Источник отсутствует',
                  sampleSize: 0,
                  summary: 'Нет данных',
                },
              },
              context: {
                resumeUpdatedAt: null,
                resumeSourceRevision: null,
                requirementSource: null,
              },
              evaluatedAt: '2026-10-17T09:30:00.000Z',
              disclaimer: 'Оценка не гарантирует прохождение отбора.',
            },
          },
        },
      }),
    );
    await openProfile(page);

    if (testInfo.project.name === 'mobile-390') {
      const mobileProfile = page.locator('.career-profile-mobile');
      await mobileProfile
        .locator('.pm-row')
        .filter({ has: page.getByText('Версии под вакансии', { exact: true }) })
        .click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'docs');
      await expect(mobileProfile.getByRole('button', { name: /Мастер-резюме/u })).toBeVisible();
      await expect(
        mobileProfile.getByRole('button', { name: 'Создать версию под вакансию', exact: true }),
      ).toBeEnabled();
      await expect(mobileProfile.getByRole('button', { name: /Под вакансию/u })).toHaveCount(0);
    } else {
      const versions = page.locator('#sec-documents');
      await expect(versions).toBeVisible();
      await expect(versions).toContainText('Мастер-резюме');
      await expect(versions).toContainText('Сохранённых снимков резюме под вакансию пока нет');
    }
    await expect(page.getByRole('button', { name: /JSON/u })).toHaveCount(0);
  });
  test('B333: печатный вид резюме — чистый документ без подсказок редактора', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stubSession(page);
    await openProfile(page);
    await expect(page.locator('.career-resume-print')).toHaveCount(1);
    await page.emulateMedia({ media: 'print' });

    const print = page.locator('.career-resume-print');
    await expect(print).toBeVisible();
    await expect(page.locator('.career-profile-screen-view')).toBeHidden();
    await expect(print).not.toContainText('Добавьте');
    await expect(print).not.toContainText('Не указано');
    await expect(print.locator('h1')).toBeVisible();

    await mkdir('output/playwright/B333', { recursive: true });
    await page.screenshot({ path: 'output/playwright/B333/print-1440.png', fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await expect(print).toBeHidden();
  });
});
