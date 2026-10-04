import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { captureCareerHarness } from './helpers/capture-career-harness';

/**
 * B160 remainder — «Изменить условия» used to open the «Аккаунт» panel,
 * which holds no role, no regions and no work mode. There was no way in the
 * product to change the premises of the candidate's own route. This spec
 * asserts the editor exists, shows the current answers and writes them to the
 * server the cabinet reads back.
 */

const CANDIDATE = {
  username: 'premises.candidate',
  email: 'premises.candidate@example.com',
  displayName: 'Кандидат Предпосылок',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b160-premises',
};

const ACCOUNT = {
  username: CANDIDATE.username,
  email: CANDIDATE.email,
  displayName: CANDIDATE.displayName,
  profile: {
    headline: 'Senior Software Engineer',
    location: 'Москва',
    workMode: 'hybrid' as const,
    updatedAt: '2026-08-18T12:00:00.000Z',
  },
  sessions: [],
};

const SNAPSHOT = {
  candidate: {
    id: CANDIDATE.candidateId,
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-08-18T12:00:00.000Z',
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

interface Captured {
  workspace?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  campaign?: { roles: string[]; regions: string[] };
}

async function stubSession(page: Page, captured: Captured): Promise<void> {
  let campaign = {
    roles: { value: ['Senior Software Engineer'], origin: 'profile' },
    regions: { value: ['ru'], origin: 'profile' },
    remoteOnly: false,
    roleHypotheses: [{ role: 'Senior Software Engineer', vacancyCount: 0, isHypothesis: false }],
  };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
    if (pathname === '/api/v1/candidate/matched-vacancies') {
      return route.fulfill({
        json: {
          data: [],
          meta: { total: 0, nextOffset: null, campaign, candidateLevel: 'Senior' },
        },
      });
    }
    if (pathname === '/api/v1/candidate/campaign' && request.method() === 'POST') {
      const update = request.postDataJSON() as { roles: string[]; regions: string[] };
      captured.campaign = update;
      campaign = {
        roles: { value: update.roles, origin: 'explicit' },
        regions: { value: update.regions, origin: 'explicit' },
        remoteOnly: false,
        roleHypotheses: update.roles.map((role) => ({
          role,
          vacancyCount: 0,
          isHypothesis: false,
        })),
      };
      return route.fulfill({ json: { data: campaign } });
    }
    if (pathname === '/api/v1/candidate/matched-vacancies') {
      return route.fulfill({
        json: {
          data: [],
          meta: {
            total: 0,
            nextOffset: null,
            campaign: {
              roles: { value: ['Senior Software Engineer'], origin: 'profile' },
              regions: { value: ['ru'], origin: 'profile' },
              remoteOnly: false,
              roleHypotheses: [
                { role: 'Senior Software Engineer', vacancyCount: 0, isHypothesis: false },
              ],
            },
            candidateLevel: 'Senior',
          },
        },
      });
    }
    if (pathname === '/api/v1/account') {
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as Record<string, unknown>;
        captured.profile = body;
        return route.fulfill({ json: { data: ACCOUNT } });
      }
      return route.fulfill({ json: { data: ACCOUNT } });
    }
    if (pathname === '/api/v1/account/profile') {
      captured.profile = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        json: {
          data: {
            ...ACCOUNT,
            profile: {
              ...ACCOUNT.profile,
              ...(captured.profile as { headline?: string; workMode?: string }),
            },
          },
        },
      });
    }
    if (pathname === '/api/v1/candidate/workspace') {
      if (request.method() === 'PUT') {
        captured.workspace = (
          request.postDataJSON() as { workspace: Record<string, unknown> }
        ).workspace;
        return route.fulfill({ json: { data: captured.workspace } });
      }
      return route.fulfill({ json: { data: null } });
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
        createdAt: '2026-08-18T12:00:00.000Z',
        updatedAt: '2026-08-18T12:00:00.000Z',
        resumeText:
          'Senior Software Engineer with 8+ years experience in TypeScript, React and distributed systems.',
        resumeSource: 'text',
        targetDirection: 'Senior Software Engineer',
        regions: ['ru'],
        currentSituation: 'Ищу работу ведущим инженером.',
        constraints: 'Remote / Hybrid',
        urgency: 'active',
        outcomes: [],
      },
    },
  );
}

async function openCareer(page: Page): Promise<void> {
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  const desktopRole = page.locator('.career-path-desktop').getByRole('button', { name: /^Роль\./ });
  if (await desktopRole.isVisible()) {
    await desktopRole.first().click();
  } else {
    const mobileRole = page.locator('.career-path-mobile-role');
    if (await mobileRole.isVisible()) {
      await mobileRole.first().click();
    } else {
      const mobileSummary = page.locator('.career-path-mobile-summary');
      if (await mobileSummary.isVisible()) {
        await mobileSummary.click();
      } else {
        await page
          .getByRole('button', { name: /Роль\./ })
          .first()
          .click();
      }
    }
  }
  // Шаг «Роль» открывает «Вакансии», предпосылки живут в панели фильтров (B366).
  await expect(page.locator('.career-route-premises')).toBeVisible();
}

test.describe('B160 route premises are editable in the cabinet', () => {
  test('the candidate changes role, regions and work mode where they are shown', async ({
    page,
  }, testInfo) => {
    const captured: Captured = {};
    await stubSession(page, captured);
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openCareer(page);

    await page.getByRole('button', { name: 'Изменить условия' }).click();

    const editor = page.locator('.career-route-premises-editor');
    await expect(editor).toBeVisible();

    const role = editor.getByLabel('Роль и уровень');
    await expect(role).toHaveValue('Senior Software Engineer');
    await role.fill('Руководитель продукта');

    await editor.getByRole('checkbox', { name: 'EU' }).check();
    await editor.getByLabel('Формат работы').selectOption('remote');
    await mkdir('output/playwright/C68', { recursive: true });
    const screenshotName =
      testInfo.project.name === 'mobile-390'
        ? 'premises-mobile-390.png'
        : 'premises-desktop-1440.png';
    await page.screenshot({
      path: `output/playwright/C68/${screenshotName}`,
      fullPage: testInfo.project.name !== 'mobile-390',
    });
    await captureCareerHarness(page, testInfo.outputPath('career-premises.html'));
    await editor.getByRole('button', { name: 'Сохранить предпосылки' }).click();

    await expect(editor).toBeHidden();
    await expect(page.locator('.career-route-premises')).toContainText('Руководитель продукта');
    await expect(page.locator('.career-route-premises')).toContainText('EU');
    await expect(page.locator('.career-route-premises')).toContainText('Удалённо');
    await page.evaluate(() => window.scrollTo(0, 0));
    const savedScreenshotName =
      testInfo.project.name === 'mobile-390'
        ? 'premises-saved-mobile-390.png'
        : 'premises-saved-desktop-1440.png';
    await page.screenshot({
      path: `output/playwright/C68/${savedScreenshotName}`,
      fullPage: testInfo.project.name !== 'mobile-390',
    });

    expect(captured.workspace?.targetDirection).toBe('Руководитель продукта');
    expect(captured.workspace?.regions).toEqual(['ru', 'eu']);
    expect(captured.campaign).toEqual({
      roles: ['Руководитель продукта'],
      regions: ['ru', 'eu'],
    });
    expect(captured.profile).toMatchObject({
      headline: 'Руководитель продукта',
      workMode: 'remote',
    });
  });

  test('the editor fits the viewport and carries no critical accessibility violation', async ({
    page,
  }) => {
    await stubSession(page, {});
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openCareer(page);
    await page.getByRole('button', { name: 'Изменить условия' }).click();
    await expect(page.locator('.career-route-premises-editor')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const results = await new AxeBuilder({ page })
      .include('.career-route-premises-editor')
      .analyze();
    expect(
      results.violations.filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      ),
    ).toEqual([]);
  });
});
