import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import type {
  CandidateFootprintAudit,
  CandidateFootprintFinding,
  FootprintAdapterId,
} from '../shared/candidateFootprint';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const SOURCE_AVAILABILITY: Readonly<Record<FootprintAdapterId, boolean>> = {
  sherlock: true,
  maigret: true,
  hibp: false,
  wayback: true,
  exa: true,
};

const PLAN = [
  {
    id: 'aaaaaaaaaaaaaaaaaaaa',
    adapterId: 'sherlock' as const,
    kind: 'username' as const,
    preview: 'Проверить открытые профили под ником «maria-sokolova»',
    selectedByDefault: true,
    available: true,
  },
  {
    id: 'bbbbbbbbbbbbbbbbbbbb',
    adapterId: 'wayback' as const,
    kind: 'profile_url' as const,
    preview: 'Проверить архив публичной страницы https://github.com/maria-sokolova',
    selectedByDefault: true,
    available: true,
  },
  {
    id: 'cccccccccccccccccccc',
    adapterId: 'exa' as const,
    kind: 'name' as const,
    preview: 'Искать открытые профили по имени «Мария Соколова»',
    selectedByDefault: true,
    available: true,
  },
  {
    id: 'eeeeeeeeeeeeeeeeeeee',
    adapterId: 'exa' as const,
    kind: 'work_context' as const,
    preview: 'Искать имя и работодателя «Analytical Engines»',
    selectedByDefault: true,
    available: true,
  },
  {
    id: 'ffffffffffffffffffff',
    adapterId: 'exa' as const,
    kind: 'work_context' as const,
    preview: 'Искать имя и город «London»',
    selectedByDefault: true,
    available: true,
  },
  {
    id: 'dddddddddddddddddddd',
    adapterId: 'hibp' as const,
    kind: 'email' as const,
    preview: 'Проверить почту m***@example.test через безопасный поиск HIBP',
    selectedByDefault: false,
    available: false,
  },
];

const SAMPLE_FINDING: CandidateFootprintFinding = {
  id: '111111111111111111111111',
  adapter: 'sherlock',
  kind: 'profile',
  url: 'https://github.com/maria-sokolova',
  title: 'GitHub',
  detail: 'Открытая страница найдена по нику; владение нужно подтвердить.',
  match: 'likely_self',
  observedAt: '2026-10-04T12:00:00.000Z',
  receipt: { method: 'GET', source: 'GitHub', query: 'username=maria-sokolova' },
  receipts: [{ method: 'GET', source: 'GitHub', query: 'username=maria-sokolova' }],
  sources: ['sherlock'],
  automatedMatch: 'likely_self',
  review: 'unreviewed',
};

function audit(
  state: CandidateFootprintAudit['state'],
  findings: CandidateFootprintFinding[],
  selectedQueryIds: readonly string[] = PLAN.filter((item) => item.available).map(
    (item) => item.id,
  ),
): CandidateFootprintAudit {
  return {
    id: 'audit-b367',
    candidateId: 'candidate-b232',
    state,
    selectedQueryIds,
    adapterStatuses: [
      {
        adapterId: 'sherlock',
        state: state === 'pending' ? 'pending' : 'checked',
        sourcesChecked: 20,
        findingsCount: findings.length,
      },
      { adapterId: 'maigret', state: 'not_run', sourcesChecked: 0, findingsCount: 0 },
      { adapterId: 'hibp', state: 'not_connected', sourcesChecked: 0, findingsCount: 0 },
      {
        adapterId: 'wayback',
        state: state === 'pending' ? 'pending' : 'checked',
        sourcesChecked: 1,
        findingsCount: 0,
      },
      {
        adapterId: 'exa',
        state: state === 'pending' ? 'pending' : 'checked',
        sourcesChecked: 2,
        findingsCount: 0,
      },
    ],
    findings,
    ownershipConfirmedAt: '2026-10-04T11:59:00.000Z',
    startedAt: '2026-10-04T12:00:00.000Z',
    ...(state === 'completed' ? { completedAt: '2026-10-04T12:00:02.000Z' } : {}),
  };
}

async function openFootprint(
  page: Page,
  routeFootprint: (route: Route) => Promise<void>,
): Promise<void> {
  await mockSignedInCabinet(page);
  await page.route('**/api/v1/candidate/footprint**', routeFootprint);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.locator('button[aria-label="Профиль"]:visible').first().click();
  await page
    .locator('.career-profile-screen-tabs')
    .getByRole('button', { name: 'Как вас видят' })
    .click();
  await expect(page.getByRole('heading', { name: 'Как вас видят', exact: true })).toBeVisible();
}

async function captureFootprint(page: Page, filename: string): Promise<void> {
  const directory = join(process.cwd(), 'output', 'playwright', 'B367');
  await mkdir(directory, { recursive: true });
  await page.addStyleTag({
    content:
      '.career-shell, .career-main { overflow: visible !important; height: auto !important; min-height: 0 !important; }',
  });
  await page.screenshot({ path: join(directory, filename), fullPage: true });
}

test('B367 keeps launch disabled until the consent text is approved', async ({ page }) => {
  let starts = 0;
  await openFootprint(page, async (route) => {
    const request = route.request();
    if (request.url().endsWith('/plan')) {
      return route.fulfill({
        json: {
          data: {
            plan: PLAN,
            sourceAvailability: SOURCE_AVAILABILITY,
            consent: { approved: false, granted: false, versionId: 'digital_footprint-v1.1' },
            audit: null,
          },
        },
      });
    }
    if (request.method() === 'POST') starts += 1;
    return route.fulfill({ status: 409, json: { error: { code: 'consent_text_not_approved' } } });
  });

  const launch = page.getByRole('button', { name: 'Скоро: ждёт утверждения текста согласия' });
  await expect(launch).toBeDisabled();
  await expect(page.getByText('источник не подключён').first()).toBeVisible();
  await expect(
    page.getByLabel('Подтверждаю, что выбранные ссылки, никнеймы и почта принадлежат мне.'),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  const width = page.viewportSize()?.width ?? 0;
  await captureFootprint(page, `footprint-locked-${width}.png`);
  expect(starts).toBe(0);
});

test('B367 reviews a mocked background run, records identity feedback, and deletes saved findings', async ({
  page,
}) => {
  let currentAudit: CandidateFootprintAudit | null = null;
  let statusReads = 0;
  let startBody: { selectedQueryIds?: string[]; confirmedOwnership?: boolean } | null = null;
  let reviewed: CandidateFootprintFinding['review'] = 'unreviewed';
  let deleted = 0;
  let consentRevocations = 0;

  await openFootprint(page, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/plan') && request.method() === 'GET') {
      return route.fulfill({
        json: {
          data: {
            plan: PLAN,
            sourceAvailability: SOURCE_AVAILABILITY,
            consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
            audit: currentAudit,
          },
        },
      });
    }
    if (pathname.endsWith('/start') && request.method() === 'POST') {
      startBody = request.postDataJSON() as {
        selectedQueryIds?: string[];
        confirmedOwnership?: boolean;
      };
      currentAudit = audit('pending', [], startBody.selectedQueryIds ?? []);
      return route.fulfill({ status: 202, json: { data: { audit: currentAudit } } });
    }
    if (pathname === '/api/v1/candidate/footprint' && request.method() === 'GET') {
      statusReads += 1;
      if (statusReads > 1)
        currentAudit = audit(
          'completed',
          [{ ...SAMPLE_FINDING, review: reviewed }],
          startBody?.selectedQueryIds ?? [],
        );
      return route.fulfill({ json: { data: { audit: currentAudit } } });
    }
    if (pathname.includes('/findings/') && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { review: CandidateFootprintFinding['review'] };
      reviewed = body.review;
      currentAudit = audit(
        'completed',
        [{ ...SAMPLE_FINDING, review: reviewed }],
        startBody?.selectedQueryIds ?? [],
      );
      return route.fulfill({ json: { data: { audit: currentAudit } } });
    }
    if (pathname === '/api/v1/candidate/footprint' && request.method() === 'DELETE') {
      deleted += 1;
      currentAudit = null;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await page.route('**/api/v1/me/consents/digital_footprint', async (route) => {
    if (route.request().method() !== 'DELETE') {
      return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
    }
    consentRevocations += 1;
    return route.fulfill({
      json: {
        data: { capability: 'digital_footprint', granted: false, revoked: true, consent: null },
      },
    });
  });

  const unchecked = page.getByRole('checkbox', { name: PLAN[1]!.preview });
  await unchecked.uncheck();
  await page.getByRole('checkbox', { name: PLAN[3]!.preview }).uncheck();
  await page.getByRole('checkbox', { name: PLAN[4]!.preview }).uncheck();
  await page
    .getByLabel('Подтверждаю, что выбранные ссылки, никнеймы и почта принадлежат мне.')
    .check();
  await page.getByRole('button', { name: 'Запустить выбранные проверки' }).click();
  await expect(
    page.getByText('Источники проверяются в фоне. Страница остаётся доступной.'),
  ).toBeVisible();
  await expect(page.getByText('GitHub', { exact: true })).toBeVisible({ timeout: 10_000 });

  expect(startBody?.confirmedOwnership).toBe(true);
  expect(startBody?.selectedQueryIds).toContain(PLAN[0]!.id);
  expect(startBody?.selectedQueryIds).not.toContain(PLAN[1]!.id);
  expect(startBody?.selectedQueryIds).not.toContain(PLAN[3]!.id);
  expect(startBody?.selectedQueryIds).not.toContain(PLAN[4]!.id);
  await captureFootprint(page, `footprint-findings-${page.viewportSize()?.width ?? 0}.png`);

  await page.getByRole('button', { name: 'Не я' }).click();
  await expect(page.getByText('Вы отметили «не я»')).toBeVisible();
  await page.getByRole('button', { name: 'Скрыть' }).click();
  await expect(page.getByText('Скрытые находки (1)')).toBeVisible();
  await page.getByText('Скрытые находки (1)').click();
  await page.getByRole('button', { name: 'Показать' }).click();
  await expect(page.getByText('Нужно проверить')).toBeVisible();
  await page.getByRole('button', { name: 'Это я' }).click();
  await expect(page.getByText('Подтверждено вами')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить сохранённые находки' }).click();
  await expect(page.getByText(/Удалить все сохранённые находки и историю проверок/u)).toBeVisible();
  await page.getByRole('button', { name: 'Удалить все находки' }).click();
  await expect(page.getByText('Сохранённые находки удалены.')).toBeVisible();
  expect(deleted).toBe(1);
  await page.getByRole('button', { name: 'Отозвать согласие' }).click();
  await expect(
    page.getByText('Согласие отозвано. Проверка остановлена, сохранённые находки удалены.'),
  ).toBeVisible();
  expect(consentRevocations).toBe(1);
  await expect(page.getByRole('button', { name: 'Выдать согласие' })).toBeDisabled();
});

test('B367 keeps consent and findings visible when revocation fails', async ({ page }) => {
  const existingAudit = audit('completed', [SAMPLE_FINDING]);
  let consentRevocations = 0;
  await openFootprint(page, async (route) => {
    const request = route.request();
    if (request.url().endsWith('/plan')) {
      return route.fulfill({
        json: {
          data: {
            plan: PLAN,
            sourceAvailability: SOURCE_AVAILABILITY,
            consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
            audit: existingAudit,
          },
        },
      });
    }
    if (request.method() === 'GET')
      return route.fulfill({ json: { data: { audit: existingAudit } } });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await page.route('**/api/v1/me/consents/digital_footprint', async (route) => {
    consentRevocations += 1;
    return route.fulfill({
      status: 503,
      json: {
        error: { code: 'consent_unavailable', message: 'Отзыв согласия временно недоступен.' },
      },
    });
  });

  await expect(page.getByText('GitHub', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отозвать согласие' }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByText(
      'Согласие выдано. Отзыв остановит текущую проверку и удалит сохранённые находки.',
    ),
  ).toBeVisible();
  await expect(page.getByText('GitHub', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отозвать согласие' })).toBeEnabled();
  expect(consentRevocations).toBe(1);
});

test('B367 ignores a late poll response after consent revocation deletes findings', async ({
  page,
}) => {
  let markPollStarted!: () => void;
  let releasePoll!: () => void;
  let markPollDelivered!: () => void;
  const pollStarted = new Promise<void>((resolve) => {
    markPollStarted = resolve;
  });
  const pollRelease = new Promise<void>((resolve) => {
    releasePoll = resolve;
  });
  const pollDelivered = new Promise<void>((resolve) => {
    markPollDelivered = resolve;
  });
  await openFootprint(page, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/plan')) {
      return route.fulfill({
        json: {
          data: {
            plan: PLAN,
            sourceAvailability: SOURCE_AVAILABILITY,
            consent: { approved: true, granted: true, versionId: 'digital_footprint-v1.1' },
            audit: audit('pending', []),
          },
        },
      });
    }
    if (pathname === '/api/v1/candidate/footprint' && request.method() === 'GET') {
      markPollStarted();
      await pollRelease;
      await route.fulfill({ json: { data: { audit: audit('completed', [SAMPLE_FINDING]) } } });
      markPollDelivered();
      return;
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await page.route('**/api/v1/me/consents/digital_footprint', async (route) =>
    route.fulfill({
      json: {
        data: { capability: 'digital_footprint', granted: false, revoked: true, consent: null },
      },
    }),
  );

  await pollStarted;
  await page.getByRole('button', { name: 'Отозвать согласие' }).click();
  await expect(
    page.getByText('Согласие отозвано. Проверка остановлена, сохранённые находки удалены.'),
  ).toBeVisible();
  releasePoll();
  await pollDelivered;
  await expect(page.getByText('GitHub', { exact: true })).toHaveCount(0);
});
