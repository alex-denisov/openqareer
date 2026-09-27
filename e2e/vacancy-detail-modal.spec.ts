import { expect, test, type Page } from '@playwright/test';

/**
 * B250 — окно «Подробнее» у вакансии: заголовок и панель «Откликнуться»
 * закреплены, прокручивается только тело, окно помещается во вьюпорт на
 * 1440 и 390, Esc закрывает и возвращает фокус на кнопку «Подробнее».
 */

const CANDIDATE = {
  username: 'modal.candidate',
  email: 'modal.candidate@example.com',
  displayName: 'Кандидат Окна',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b250-modal',
};

const ACCOUNT = {
  username: CANDIDATE.username,
  email: CANDIDATE.email,
  displayName: CANDIDATE.displayName,
  profile: {
    headline: 'VP Technology Operations',
    location: 'Дубай',
    workMode: 'hybrid' as const,
    updatedAt: '2026-09-01T12:00:00.000Z',
  },
  sessions: [],
};

const SNAPSHOT = {
  candidate: {
    id: CANDIDATE.candidateId,
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-09-01T12:00:00.000Z',
  },
  messages: [],
  memory: [],
  turns: [],
  dossier: {
    sections: [],
    confirmedCount: 3,
    proposedCount: 0,
    readiness: { complete: true, unresolvedQuestions: 0, checks: [] },
  },
  documents: [],
  assessments: [],
  germanyMarket: null,
  vacancySubscriptions: [],
};

const CAMPAIGN = {
  roles: { value: ['Enterprise Architect'], origin: 'profile' },
  regions: { value: ['United States'], origin: 'profile' },
  remoteOnly: false,
  autoRoles: [{ id: 'architect.primary', title: 'Enterprise Architect', kind: 'primary' as const }],
  roleHypotheses: [{ role: 'Enterprise Architect', vacancyCount: 1, isHypothesis: false }],
};

// Длинный текст с абзацами и списком — тело должно прокручиваться, а
// заголовок и панель «Откликнуться»/«Открыть на площадке» — оставаться на месте.
const LONG_DESCRIPTION = [
  'О роли',
  '',
  Array.from(
    { length: 40 },
    (_, index) => `Абзац с описанием обязанностей номер ${index + 1}.`,
  ).join(' '),
  '',
  '- Первое требование',
  '- Второе требование',
  '- Третье требование',
].join('\n');

const MATCHED_ITEMS = [
  {
    cluster: {
      id: 'c-modal-1',
      canonicalTitle: 'Enterprise Architect, Senior',
      canonicalCompany: 'Peraton',
      canonicalLocation: 'United States',
      isRemote: false,
      salary: { from: 180000, currency: 'USD', gross: true },
      descriptionSummary: LONG_DESCRIPTION,
      skills: ['Cloud', 'Enterprise Architecture'],
      primaryUrl: 'https://example.com/vacancy',
      sources: [
        {
          sourceType: 'hh',
          sourceId: 'c-modal-1',
          sourceName: 'hh.ru',
          sourceUrl: 'https://hh.ru/vacancy',
          observedAt: '2026-09-20T08:00:00.000Z',
        },
      ],
      firstObservedAt: '2026-09-20T08:00:00.000Z',
      lastSeenAt: '2026-09-23T08:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: 'c-modal-1',
      roleMatch: 'target',
      levelMatch: 'match',
      outsideGeography: false,
      matchingPoints: ['Опыт управления командой'],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-24T08:00:00.000Z',
    },
  },
];

async function stubSession(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
    if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
    if (pathname === '/api/v1/candidate/connections') return route.fulfill({ json: { data: [] } });
    if (pathname === '/api/v1/candidate/workspace') return route.fulfill({ json: { data: null } });
    if (pathname === '/api/v1/candidate/vacancy-sources') {
      return route.fulfill({
        json: { data: [{ id: 'hh', name: 'hh.ru', health: { status: 'healthy' } }] },
      });
    }
    if (pathname === '/api/v1/candidate/matched-vacancies') {
      return route.fulfill({
        json: {
          data: MATCHED_ITEMS,
          meta: { total: 1, nextOffset: null, campaign: CAMPAIGN, candidateLevel: 'VP / C-level' },
        },
      });
    }
    if (pathname.endsWith('/detail')) {
      return route.fulfill({
        json: {
          data: {
            id: 'c-modal-1',
            description: LONG_DESCRIPTION,
            truncated: false,
            skills: ['Cloud'],
            responsibilities: [],
          },
        },
      });
    }
    if (pathname.includes('enrich-contacts')) {
      return route.fulfill({ status: 503, json: { error: { message: 'offline' } } });
    }
    return route.fulfill({ json: { data: null } });
  });
}

async function seedWorkspace(page: Page): Promise<void> {
  await page.addInitScript(
    ({ storageKey, ownerKey, candidateId }) => {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 7,
          createdAt: '2026-09-01T12:00:00.000Z',
          updatedAt: '2026-09-01T12:00:00.000Z',
          resumeText:
            'VP Technology Operations with 15+ years scaling platform and operations organisations.',
          resumeSource: 'text',
          targetDirection: 'VP Technology Ops',
          regions: ['mena', 'eu'],
          currentSituation: 'Ищу VP-роль в операциях технологической компании.',
          constraints: 'Hybrid',
          urgency: 'active',
          outcomes: [],
          analysis: {
            evidenceMethodVersion: 'evidence-local-v1',
            roleMethodVersion: 'role-hypotheses-local-v1',
            evidenceItems: [
              {
                id: 'evidence-1',
                kind: 'result',
                sourceExcerpt: 'Сократил время закрытия вакансий на 30%',
                statement: 'Сократил время закрытия вакансий на 30%',
                status: 'confirmed',
                userEdited: false,
              },
              {
                id: 'evidence-2',
                kind: 'scope',
                sourceExcerpt: 'Руководил командой архитекторов из 12 человек',
                statement: 'Руководил командой архитекторов из 12 человек',
                status: 'confirmed',
                userEdited: false,
              },
              {
                id: 'evidence-3',
                kind: 'scope',
                sourceExcerpt: 'Отвечал за архитектуру платформы в 3 регионах',
                statement: 'Отвечал за архитектуру платформы в 3 регионах',
                status: 'confirmed',
                userEdited: false,
              },
            ],
            questions: [],
            roleHypotheses: [
              {
                id: 'role-enterprise-architect',
                title: 'Enterprise Architect',
                fitState: 'plausible',
                basis: 'Опыт архитектуры платформы и управления командой',
                evidenceIds: ['evidence-1', 'evidence-2', 'evidence-3'],
                gaps: [],
              },
            ],
          },
          marketSample: {
            source: 'hh',
            query: 'Enterprise Architect',
            found: 1,
            fetchedAt: '2026-09-20T08:00:00.000Z',
            items: [
              {
                id: 'market-1',
                title: 'Enterprise Architect',
                company: 'Компания 1',
                location: 'Дубай',
                sourceUrl: 'https://hh.ru/vacancy/100000',
                publishedAt: null,
                salary: null,
              },
            ],
          },
        }),
      );
      window.localStorage.setItem(ownerKey, candidateId);
    },
    {
      storageKey: 'candidate-workspace',
      ownerKey: 'candidate-workspace-owner',
      candidateId: CANDIDATE.candidateId,
    },
  );
}

async function openInfoModal(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.locator('button[aria-label="Вакансии"]:visible').first().click();
  await expect(page.locator('.vacancies-screen')).toBeVisible();
  if (page.viewportSize()?.width === 390) {
    await page.locator('.vac-list-item').first().locator('.vac-row').click();
  }
  await page.locator('.vacancies-detail-col').getByRole('button', { name: 'Подробнее' }).click();
  await expect(page.locator('.career-modal-card.is-detail')).toBeVisible();
}

test.describe('B250 vacancy detail modal', () => {
  test('fits the 1440 viewport, scrolls only the body, Esc closes and returns focus', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openInfoModal(page);

    const card = page.locator('.career-modal-card.is-detail');
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(720);
    expect(box!.height).toBeLessThanOrEqual(900 * 0.85 + 1);

    // Заголовок и панель «Открыть на площадке» закреплены — тело прокручивается отдельно.
    const scroll = page.locator('.vacancies-info-scroll');
    const scrollMetrics = await scroll.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    await expect(page.locator('.vacancies-info-footer')).toBeVisible();

    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/vacancy-detail-modal-1440.png`
        : 'output/playwright/C51b/vacancy-detail-modal-1440.png',
    });

    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(
      page.locator('.vacancies-detail-col').getByRole('button', { name: 'Подробнее' }),
    ).toBeFocused();
  });

  test('fills the mobile 390 viewport as a full-screen sheet with no horizontal overflow', async ({
    page,
  }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openInfoModal(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const card = page.locator('.career-modal-card.is-detail');
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(389);
    expect(box!.height).toBeGreaterThanOrEqual(843);
    await expect(page.locator('.vacancies-info-footer')).toBeVisible();

    await page.screenshot({
      path: process.env.SHOTS_DIR
        ? `${process.env.SHOTS_DIR}/vacancy-detail-modal-390.png`
        : 'output/playwright/C51b/vacancy-detail-modal-390.png',
    });
  });

  test('closes on a backdrop click', async ({ page }) => {
    await stubSession(page);
    await seedWorkspace(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openInfoModal(page);

    await page.locator('.career-modal-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.career-modal-card.is-detail')).toHaveCount(0);
  });
});
