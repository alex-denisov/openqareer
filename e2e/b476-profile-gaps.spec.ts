import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { buildResumeAtsAssessment } from '../server/domain/resumeAtsAssessment';
import { formatTargetedResumeAsAtsText } from '../server/domain/resumeAtsText';
import { buildTargetedResumeSlice } from '../server/domain/resumeStudio';
import type { ResumeDocument } from '../server/domain/resumeStudioTypes';
import { estimateResumePages } from '../server/domain/resumeTargetedVolume';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { waitForCareerShell } from './helpers/waitForCareerShell';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR = e2eEvidenceDirectory('B476');
const TARGETED_VERSION_ID = '123e4567-e89b-12d3-a456-426614174002';
const MASTER_REVISION = 'b476-e2e-master-revision';
const TARGETED_RESUME_DOCUMENT: ResumeDocument = {
  kind: 'master',
  targetRole: null,
  contact: {
    fullName: 'MILA EXAMPLE',
    email: 'mila@example.test',
    phone: null,
    location: 'Berlin',
    links: [],
  },
  about: null,
  experience: [],
  skills: [],
  education: [],
  projects: [],
  languages: [],
  unknowns: [],
  conventions: {
    country: null,
    packVersion: null,
    reverseChronological: true,
    maxPages: null,
    recommendedBulletsPerRole: null,
    photo: 'omitted',
    discriminatoryPii: 'omitted',
  },
  length: { lines: 0, pages: 1, linesPerPage: 45 },
};

test.describe('B476: Profile gaps mechanics (About, Review, Versions)', () => {
  test.beforeAll(async () => {
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await mkdir('output/playwright/B476', { recursive: true });
  });

  test('profile screen renders and activates all B476 actions', async ({ page }, testInfo) => {
    await mockSignedInCabinet(page);
    let storedVersion: {
      readonly id: string;
      readonly title: string;
      readonly requirements: readonly string[];
      readonly status: 'draft';
      readonly revision: number;
      readonly sourceMasterRevision: string;
      readonly createdAt: string;
      readonly updatedAt: string;
      readonly snapshot: ReturnType<typeof estimateResumePages>;
    } | null = null;
    const makeSnapshot = (title: string, requirements: readonly string[]) =>
      estimateResumePages(
        buildTargetedResumeSlice(TARGETED_RESUME_DOCUMENT, { title, requirements }),
      );

    await page.route('**/api/v1/candidate/resume/versions**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname.endsWith('/versions')) {
        const items = storedVersion
          ? [
              {
                id: storedVersion.id,
                title: storedVersion.title,
                requirements: storedVersion.requirements,
                status: storedVersion.status,
                revision: storedVersion.revision,
                sourceMasterRevision: storedVersion.sourceMasterRevision,
                createdAt: storedVersion.createdAt,
                updatedAt: storedVersion.updatedAt,
              },
            ]
          : [];
        return route.fulfill({
          json: {
            data: {
              items,
              nextCursor: null,
              totalCount: items.length,
              currentMasterRevision: MASTER_REVISION,
            },
          },
        });
      }

      if (request.method() === 'POST' && url.pathname.endsWith('/versions')) {
        const input = request.postDataJSON() as {
          readonly title: string;
          readonly requirements: readonly string[];
          readonly expectedMasterRevision: string;
        };
        storedVersion = {
          id: TARGETED_VERSION_ID,
          title: input.title,
          requirements: input.requirements,
          status: 'draft',
          revision: 1,
          sourceMasterRevision: MASTER_REVISION,
          createdAt: '2026-10-17T09:00:00.000Z',
          updatedAt: '2026-10-17T09:00:00.000Z',
          snapshot: makeSnapshot(input.title, input.requirements),
        };
        return route.fulfill({
          status: 201,
          headers: {
            Location: `/api/v1/candidate/resume/versions/${TARGETED_VERSION_ID}`,
            ETag: `"${TARGETED_VERSION_ID}-1"`,
          },
          json: { data: { version: storedVersion, currentMasterRevision: MASTER_REVISION } },
        });
      }

      if (request.method() === 'GET' && url.pathname.endsWith(`/versions/${TARGETED_VERSION_ID}`)) {
        return storedVersion
          ? route.fulfill({
              headers: { 'Cache-Control': 'private, no-store' },
              json: { data: { version: storedVersion, currentMasterRevision: MASTER_REVISION } },
            })
          : route.fulfill({
              status: 404,
              json: { error: { code: 'resume_version_not_found', message: 'Версия не найдена.' } },
            });
      }

      if (request.method() === 'PUT' && url.pathname.endsWith(`/versions/${TARGETED_VERSION_ID}`)) {
        const input = request.postDataJSON() as {
          readonly title: string;
          readonly requirements: readonly string[];
          readonly expectedRevision: number;
          readonly expectedMasterRevision: string;
        };
        if (
          !storedVersion ||
          input.expectedRevision !== storedVersion.revision ||
          input.expectedMasterRevision !== MASTER_REVISION
        ) {
          return route.fulfill({
            status: 409,
            json: {
              error: {
                code: 'resume_version_conflict',
                message:
                  'Версия или мастер-резюме изменились. Обновите данные и повторите действие.',
              },
            },
          });
        }
        storedVersion = {
          ...storedVersion,
          title: input.title,
          requirements: input.requirements,
          revision: storedVersion.revision + 1,
          updatedAt: '2026-10-17T09:15:00.000Z',
          snapshot: makeSnapshot(input.title, input.requirements),
        };
        return route.fulfill({
          headers: { ETag: `"${TARGETED_VERSION_ID}-${storedVersion.revision}"` },
          json: { data: { version: storedVersion, currentMasterRevision: MASTER_REVISION } },
        });
      }

      return route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
    });
    await page.route('**/api/v1/candidate/resume/ats-assessment', async (route) => {
      const body = route.request().postDataJSON() as { readonly versionId?: string };
      const evaluatedAt = '2026-10-17T09:30:00.000Z';
      const assessment =
        body.versionId && storedVersion
          ? buildResumeAtsAssessment({
              document: storedVersion.snapshot.document,
              atsText: formatTargetedResumeAsAtsText(storedVersion.snapshot),
              requirements: storedVersion.requirements,
              requirementSource: {
                kind: 'candidate_input',
                label: storedVersion.title,
                capturedAt: storedVersion.createdAt,
              },
              resumeUpdatedAt: null,
              resumeSourceRevision: storedVersion.sourceMasterRevision,
              evaluatedAt,
            })
          : buildResumeAtsAssessment({
              document: TARGETED_RESUME_DOCUMENT,
              atsText: '',
              requirements: [],
              requirementSource: null,
              resumeUpdatedAt: null,
              evaluatedAt,
            });
      return route.fulfill({ json: { data: { assessment } } });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    const isMobile = testInfo.project.name === 'mobile-390';
    if (isMobile) {
      await page.locator('.career-mobile-nav').getByRole('button', { name: 'Профиль' }).click();
    } else {
      await page.locator('aside#career-rail nav').getByRole('button', { name: 'Профиль' }).click();
    }

    const prefix = isMobile ? '390' : '1440';
    const mobileProfile = page.locator('.career-profile-mobile');
    const openMobileProfileRow = (label: string) =>
      mobileProfile.locator('.pm-row').filter({ has: page.getByText(label, { exact: true }) });

    if (isMobile) {
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'home');
      await expect(page.getByRole('tab', { name: 'Навыки', exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'След', exact: true })).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/b476-profile-${prefix}.png`,
        fullPage: false,
      });

      await openMobileProfileRow('Проверка').click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'check');
      const fillQuestionnaire = page.getByRole('button', {
        name: 'Собрать факты с консультантом',
        exact: true,
      });
      await expect(fillQuestionnaire).toBeEnabled();
      await fillQuestionnaire.click();
      const expert = page.locator('.career-expert-panel');
      await expect(expert).toBeVisible();
      await expect(
        expert.getByRole('textbox', { name: 'Сообщение карьерному консультанту' }),
      ).toHaveValue(/раздел профиля «Проверка резюме»/u);
      await page.keyboard.press('Escape');
      await expect(expert).toBeHidden();
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'home');
      await openMobileProfileRow('Версии под вакансии').click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'docs');
    } else {
      const fixWithConsultantBtn = page.locator('[data-testid="review-fix-with-consultant-btn"]');
      await expect(fixWithConsultantBtn).toBeVisible();

      // The approved 1440 mockup has one review action; the questionnaire lives on 390.
      await expect(page.locator('[data-testid="review-fill-questionnaire-btn"]')).toHaveCount(0);

      const aboutEditBtn = page.getByRole('button', { name: 'Изменить «Обо мне»', exact: true });
      await expect(aboutEditBtn).toBeVisible();

      await page.getByRole('button', { name: 'Открыть данные профиля', exact: true }).click();
      const profileData = page.getByRole('dialog', { name: 'Данные профиля', exact: true });
      await profileData.getByRole('button', { name: 'Обо мне', exact: true }).click();
      const aboutData = page.getByRole('dialog', { name: 'Обо мне', exact: true });
      await expect(aboutData.getByTestId('about-consultant-suggest-btn')).toBeEnabled();
      await aboutData.getByRole('button', { name: 'Закрыть данные профиля', exact: true }).click();

      await page.screenshot({
        path: `${EVIDENCE_DIR}/b476-profile-${prefix}.png`,
        fullPage: false,
      });
    }

    if (!isMobile) {
      // 1440 shows the versions as in the mockup; creation sits behind «Показать ещё».
      await page.locator('#sec-documents button[aria-controls="docs-more"]').click();
    }
    const createVersionBtn = isMobile
      ? page.getByRole('button', { name: 'Создать версию под вакансию', exact: true })
      : page.locator('[data-testid="create-targeted-version-btn"]');
    await expect(createVersionBtn).toBeVisible();
    await expect(createVersionBtn).toBeEnabled();

    // Create through the UI, reopen through GET, edit with CAS, then verify the stored snapshot after reload.
    await createVersionBtn.click();
    const versionInput = page.locator('[data-testid="targeted-version-input"]');
    const requirementsInput = page.locator('[data-testid="targeted-version-requirements"]');
    await expect(versionInput).toBeVisible();
    await versionInput.fill('Вектор Банк');
    await requirementsInput.fill('Kubernetes');
    const submitVersion = page.locator('[data-testid="submit-targeted-version-btn"]');
    await expect(submitVersion).toBeEnabled();
    await submitVersion.click();

    await expect(page.getByText('Версия под вакансию «Вектор Банк»')).toBeVisible();
    await expect(page.locator('.career-resume-ats-view code')).toContainText('MILA EXAMPLE');
    await expect(page.locator('.career-resume-ats-view code')).toContainText('Kubernetes');

    await page.getByTestId('close-targeted-version').click();
    const openVersion = isMobile
      ? openMobileProfileRow('Под вакансию «Вектор Банк»')
      : page.getByTestId(`open-targeted-version-${TARGETED_VERSION_ID}`);
    await expect(openVersion).toBeVisible();
    await openVersion.click();
    const targetView = page.locator('.career-resume-ats-view');
    await expect(targetView).toBeVisible();
    await expect(targetView.locator('code')).toContainText('MILA EXAMPLE');

    const savedTitle = targetView.locator('form input');
    const savedRequirements = targetView.locator('form textarea');
    await savedTitle.fill('Вектор Банк — Platform Engineer');
    await savedRequirements.fill('Kubernetes\nTerraform');
    await targetView.getByRole('button', { name: 'Сохранить версию' }).click();
    await expect(
      page.getByRole('heading', { name: 'Версия под вакансию «Вектор Банк — Platform Engineer»' }),
    ).toBeVisible();

    await page.screenshot({
      path: `${EVIDENCE_DIR}/b476-profile-version-created-${prefix}.png`,
      fullPage: false,
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    if (isMobile) {
      await page.locator('.career-mobile-nav').getByRole('button', { name: 'Профиль' }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'home');
      await openMobileProfileRow('Версии под вакансии').click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'docs');
    } else {
      await page.locator('aside#career-rail nav').getByRole('button', { name: 'Профиль' }).click();
    }
    const reopenedVersion = isMobile
      ? openMobileProfileRow('Под вакансию «Вектор Банк — Platform Engineer»')
      : page.getByTestId(`open-targeted-version-${TARGETED_VERSION_ID}`);
    await expect(reopenedVersion).toBeVisible();
    await reopenedVersion.click();
    await expect(
      page.getByRole('heading', {
        name: 'Версия под вакансию «Вектор Банк — Platform Engineer»',
      }),
    ).toBeVisible();
    await expect(page.locator('.career-resume-ats-view code')).toContainText('MILA EXAMPLE');

    if (isMobile) {
      await page.getByTestId('close-targeted-version').click();
      await page.getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'home');
      await openMobileProfileRow('Обо мне').click();
      await expect(mobileProfile).toHaveAttribute('data-mobile-profile-page', 'about');

      const aboutEditBtn = page.getByRole('button', { name: 'Изменить текст', exact: true });
      await expect(aboutEditBtn).toBeVisible();
      await aboutEditBtn.click();
      await expect(page.getByRole('textbox', { name: 'Обо мне', exact: true })).toBeVisible();
      await page.screenshot({
        path: `${EVIDENCE_DIR}/b476-profile-about-edit-${prefix}.png`,
        fullPage: false,
      });
      await page.getByRole('button', { name: 'Отменить', exact: true }).click();

      const aboutSuggestBtn = page.getByRole('button', {
        name: 'Предложить вариант с консультантом',
        exact: true,
      });
      await aboutSuggestBtn.click();
      const expert = page.locator('.career-expert-panel');
      await expect(expert).toBeVisible();
      await expect(
        expert.getByRole('textbox', { name: 'Сообщение карьерному консультанту' }),
      ).toHaveValue(/раздела профиля «Обо мне»/u);
    } else {
      // The button opens the real profile-stage consultant with a grounded request.
      await page.getByRole('button', { name: 'Открыть данные профиля', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Данные профиля', exact: true })
        .getByRole('button', { name: 'Обо мне', exact: true })
        .click();
      const aboutSuggestBtn = page
        .getByRole('dialog', { name: 'Обо мне', exact: true })
        .getByTestId('about-consultant-suggest-btn');
      await aboutSuggestBtn.click();
      const expert = page.locator('.career-expert-panel');
      await expect(expert).toBeVisible();
      await expect(
        expert.getByRole('textbox', { name: 'Сообщение карьерному консультанту' }),
      ).toHaveValue(/раздела профиля «Обо мне»/u);

      // Test edit text in About
      const aboutEditBtn = page.getByRole('button', { name: 'Изменить «Обо мне»', exact: true });
      await aboutEditBtn.click();
      await expect(page.locator('textarea#about-edit-input')).toBeVisible();

      await page.screenshot({
        path: `${EVIDENCE_DIR}/b476-profile-about-edit-${prefix}.png`,
        fullPage: false,
      });
    }
  });
});
