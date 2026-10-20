import { zipSync, strToU8 } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { captureCareerHarness } from './helpers/capture-career-harness';
import { candidateSnapshot } from './fixtures/readabilityWorkspace';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';

const evidence = e2eEvidenceDirectory('BLOCK-0');
async function capture(page: Page, name: string) {
  fs.mkdirSync(evidence, { recursive: true });
  await captureCareerHarness(
    page,
    path.join(evidence, `${name}-${page.viewportSize()!.width}.html`),
  );
  await page.screenshot({
    path: path.join(evidence, `${name}-${page.viewportSize()!.width}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

test('loading shell has an honest notification placeholder', async ({ page }) => {
  await mockSignedInCabinet(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await pending;
    await route.fallback();
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.career-shell')).toBeVisible({ timeout: 15_000 });
  if (page.viewportSize()!.width === 390) {
    await expect(page.getByRole('status', { name: 'Уведомления загружаются' })).toBeVisible();
    await expect(page.locator('.career-bootstrap-bell .career-notification-badge')).toHaveText('…');
  }
  const expectedHeights = page.viewportSize()!.width === 390 ? [180, 275, 184] : [214, 293, 202];
  const cards = page.locator('.career-today-skeleton-card');
  await expect(cards).toHaveCount(3);
  // The prerendered skeleton is swapped for the same React skeleton once the
  // bundle mounts; one read of all three keeps the check off that instant.
  await expect
    .poll(() =>
      cards.evaluateAll(
        (nodes, expected) =>
          nodes.length === expected.length &&
          nodes.every(
            (node, index) => Math.abs(node.getBoundingClientRect().height - expected[index]) <= 1,
          ),
        expectedHeights,
      ),
    )
    .toBe(true);
  await capture(page, 'session-loading');
  release();
  await expect(page.locator('.career-today')).toBeVisible();
});

async function openProposal(page: Page) {
  await mockSignedInCabinet(page);
  const messages = [
    { id: 'block0-user', role: 'user', content: 'Почему именно это?' },
    {
      id: 'block0-assistant',
      role: 'assistant',
      content:
        'В очереди есть задача без ответа. Можно поставить напоминание на место решения дня.',
    },
  ];
  await page.route('**/api/v1/candidate/me?*', (route) =>
    route.fulfill({ json: { data: { ...candidateSnapshot, messages } } }),
  );
  await page.route('**/api/v1/candidate/me/messages?*', (route) =>
    route.fulfill({ json: { data: messages, meta: { nextOffset: null } } }),
  );
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/, { timeout: 15_000 });
  const open = async () => {
    if (page.viewportSize()!.width === 390)
      await page.getByRole('button', { name: 'Консультант: открыть', exact: true }).click();
    else if (await page.getByRole('button', { name: /^Развернуть консультанта/ }).isVisible())
      await page.getByRole('button', { name: /^Развернуть консультанта/ }).click();
  };
  await open();
  const proposal = page.getByRole('region', { name: 'Заменить решение дня' });
  await expect(proposal).toBeVisible();
  await capture(page, 'consultant-proposal');
  return proposal;
}

test('consultant proposal retries acceptance and survives reload', async ({ page }) => {
  const proposal = await openProposal(page);
  // A failed write must leave both choices available for retry.
  await page.route(
    '**/api/v1/candidate/today/decision',
    (route) => route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } }),
    { times: 1 },
  );
  await proposal.getByRole('button', { name: 'Принять', exact: true }).click();
  await expect(proposal.getByRole('alert')).toBeVisible();
  await capture(page, 'consultant-proposal-error');
  await proposal.getByRole('button', { name: 'Принять', exact: true }).click();
  await expect(proposal).toHaveCount(0);
  if (page.viewportSize()!.width === 390) await page.keyboard.press('Escape');
  await expect(
    page.getByRole('region', { name: 'Следующее решение' }).getByRole('heading'),
  ).toContainText('Напомнить компании Ozon');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('region', { name: 'Следующее решение' }).getByRole('heading'),
  ).toContainText('Напомнить компании Ozon');
  await capture(page, 'decision-accepted');
});

test('first run reads a real DOCX document and retains its text for completion', async ({
  page,
}) => {
  await mockSignedInCabinet(page);
  let savedWorkspace: Record<string, unknown> | null = null;
  await page.route('**/api/v1/candidate/workspace', (route) => {
    if (route.request().method() === 'PUT')
      savedWorkspace = route.request().postDataJSON().workspace;
    return route.fulfill({ json: { data: savedWorkspace } });
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('goal-textarea').fill('Ищу работу разработчиком.');
  await page.getByTestId('save-goal-btn').click();
  await page.getByTestId('source-opt-file').click();
  if (page.viewportSize()!.width === 390) await page.getByTestId('source-next-btn').click();
  const text = 'Иван Тестовый. Разработчик. Опыт работы: TypeScript, React, SQL.';
  const document = zipSync({
    'word/document.xml': strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  });
  await page.getByTestId('native-file-input').setInputFiles({
    name: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(document),
  });
  await expect(page.getByText(/Резюме прочитано/).first()).toBeVisible();
  await capture(page, 'docx-read');
  if (page.viewportSize()!.width === 390) await page.getByTestId('source-next-btn').click();
  else await page.getByTestId('source-opt-file').click();
  await expect(page.getByTestId('context-submit-btn')).toBeVisible();
  await page.getByTestId('context-submit-btn').click();
  await expect.poll(() => savedWorkspace?.resumeText).toBe(text);
  expect(savedWorkspace?.resumeFileName).toBe('resume.docx');
  expect(savedWorkspace?.resumePageCount).toBeUndefined();
  await expect(page.getByTestId('first-run-wizard')).toHaveCount(0);
});

test('declining a proposal preserves the original decision and persists after reload', async ({
  page,
}) => {
  const proposal = await openProposal(page);
  await proposal.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(proposal).toHaveCount(0);
  if (page.viewportSize()!.width === 390) await page.keyboard.press('Escape');
  const decision = page.getByRole('region', { name: 'Следующее решение' });
  await expect(decision.getByRole('heading')).not.toContainText('Напомнить компании Ozon');
  await capture(page, 'decision-dismissed');
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (page.viewportSize()!.width === 390)
    await page.getByRole('button', { name: 'Консультант: открыть', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Заменить решение дня' })).toHaveCount(0);
});
