import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const SHOTS = join(process.cwd(), 'test-results', 'evidence', 'AUD-9');
const RECIPIENT = {
  id: 'contact-irina',
  fullName: 'Ирина Синтетова',
  roleTitle: 'Директор по продукту',
  companyName: 'FinCloud',
};

interface GateState {
  approvals: Record<string, unknown>[];
  prepareCalls: number;
}

function circlesResponse(vacancyId: string) {
  return {
    data: {
      vacancyId,
      companyKey: 'fincloud',
      companyName: 'FinCloud',
      vacancyTitle: 'Head of Product, Payments',
      resume: { available: true, kind: 'targeted' },
      circles: [
        {
          circle: 1,
          state: 'available',
          message: 'Знакомый работает в компании.',
          paths: [
            {
              id: 'path-irina',
              circle: 1,
              recipient: RECIPIENT,
              path: [],
              evidence: ['Связь подтверждена в профиле кандидата'],
              strength: 'direct',
              source: 'manual',
              nextStep: 'write_known_contact',
            },
          ],
        },
        { circle: 2, state: 'none', message: 'Связей второго круга нет.', paths: [] },
        { circle: 3, state: 'available', message: 'Холодный отклик.', paths: [] },
      ],
      linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
    },
  };
}

function pitchResponse(vacancyId: string) {
  return {
    data: {
      vacancyId,
      emailPitch: {
        subject: 'О роли в FinCloud',
        body: 'Ирина, добрый день. Пишу по поводу роли.',
      },
      contactMessage: 'Ирина, добрый день. Пишу по поводу роли в FinCloud.',
      linkedInNote: 'Короткое сообщение.',
      atsCoverLetter: 'Письмо.',
      usedEvidenceIds: [],
      language: 'ru',
      resumeAvailable: true,
      resumeKind: 'targeted',
      generatedAt: '2026-11-08T10:00:00.000Z',
    },
  };
}

const SNAPSHOT_FAILED = {
  error: {
    code: 'resume_snapshot_failed',
    message: 'Не удалось подготовить резюме. Подготовьте его, чтобы одобрить письмо.',
    retryable: true,
    details: { generalResume: { documentId: 'document-own-cv', fileName: 'cv.pdf' } },
  },
};

/** Снимок резюме не создаётся ни при одобрении, ни при повторе; своё общее резюме принимается. */
async function installGateRoutes(page: Page, state: GateState): Promise<void> {
  const vacancyOf = (url: string) =>
    decodeURIComponent(new URL(url).pathname.split('/').at(-2) ?? '');
  await page.route('**/api/v1/candidate/vacancies/*/connection-circles', (route) =>
    route.fulfill({ json: circlesResponse(vacancyOf(route.request().url())) }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/pitch', (route) =>
    route.fulfill({ json: pitchResponse(vacancyOf(route.request().url())) }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/letter-resume', (route) => {
    state.prepareCalls += 1;
    return route.fulfill({ status: 503, json: SNAPSHOT_FAILED });
  });
  await page.route('**/api/v1/candidate/vacancies/*/letter-approvals', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.approvals.push(body);
    if (!body.generalResumeId) return route.fulfill({ status: 503, json: SNAPSHOT_FAILED });
    return route.fulfill({
      json: {
        data: {
          applicationId: 'application-b601',
          documentId: 'document-b601-letter',
          approvedAt: '2026-11-08T10:00:00.000Z',
          status: 'approved',
          sent: false,
          resume: {
            kind: 'general',
            versionId: null,
            documentId: 'document-own-cv',
            snapshotAt: '2026-10-02T12:00:00.000Z',
          },
        },
      },
    });
  });
}

test('B601 390: circle 1 is not stuck when the resume snapshot fails', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'mobile circle 1 page');
  const state: GateState = { approvals: [], prepareCalls: 0 };
  await mockSignedInCabinet(page);
  await installGateRoutes(page, state);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  const item = page.locator('.vac-list-item').first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.locator('.vacancies-screen-row-trigger').click();
  const push = page.locator('.vacancy-push');
  await push.getByRole('button', { name: /Путь к компании/u }).click();
  await push.getByRole('button', { name: /Круг 1/u }).click();
  const approve = push.getByRole('button', { name: 'Одобрить и отправить' });
  await expect(approve).toBeEnabled({ timeout: 15_000 });
  await approve.click();

  const row = push.locator('.career-letter-dest-row');
  await expect(row).toContainText(
    'Не удалось подготовить резюме. Подготовьте его, чтобы одобрить письмо',
  );
  await expect(approve).toBeDisabled();
  await row.getByRole('button', { name: 'Подготовить резюме' }).click();
  await expect(row).toContainText('Можно приложить ваше общее резюме „cv.pdf“');
  expect(state.prepareCalls).toBe(1);
  await row.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, '390x844-resume-circle1-offer-general.png') });

  await row.getByRole('button', { name: 'Приложить общее резюме' }).click();
  await expect(push.getByRole('button', { name: 'Одобрено' })).toBeVisible();
  expect(state.approvals.at(-1)).toMatchObject({
    generalResumeId: 'document-own-cv',
    resumeAvailable: true,
  });
});
