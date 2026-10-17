import { chromium, type Page } from 'playwright';
import { advanceFirstRunSource } from '../e2e/helpers/advance-first-run-source.mjs';
import { captureScrollableScreen } from './block0-screenshot';
import { captureCareerHarness } from '../e2e/helpers/capture-career-harness';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { mockSignedInCabinet } from '../e2e/fixtures/mockSignedInCabinet';
import { candidateSnapshot } from '../e2e/fixtures/readabilityWorkspace';

const root = path.resolve('output/block-0');
const browser = await chromium.launch();
const messages = [
  { id: 'review-user', role: 'user', content: 'Почему именно это?' },
  {
    id: 'review-assistant',
    role: 'assistant',
    content: 'В очереди есть задача без ответа. Можно поставить напоминание на место решения дня.',
  },
];
const history = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    stage: 'today',
    firstPhrase: 'Почему именно это решение на сегодня?',
    summary: null,
    lastMessageAt: '2026-10-15T10:00:00Z',
    openedAt: '2026-10-15T10:00:00Z',
    closedAt: null,
    messageCount: 2,
  },
];
async function captureHistory(p: Page, shot: (page: Page, name: string) => Promise<void>) {
  const panel = p.locator('.career-expert-panel');
  let mode = 'normal';
  await p.route('**/api/v1/candidate/consultant-history**', async (r) => {
    if (mode === 'error')
      return r.fulfill({ status: 503, json: { error: { message: 'offline' } } });
    const detail = new URL(r.request().url()).pathname.endsWith(history[0].id);
    const data = detail
      ? { ...history[0], messages: [{ ...messages[1], createdAt: history[0].lastMessageAt }] }
      : mode === 'empty'
        ? []
        : history;
    await r.fulfill({ json: { data } });
  });
  const hist = panel.getByRole('button', { name: 'История бесед', exact: true });
  await hist.click();
  await expect(panel.getByRole('button', { name: /Открыть беседу:/ })).toBeVisible();
  await shot(p, 'history');
  await panel.getByRole('button', { name: /Открыть беседу:/ }).click();
  await expect(panel.getByLabel('Открытая беседа')).toBeVisible();
  await shot(p, 'history-detail');
  await panel.getByRole('button', { name: 'К истории', exact: true }).click();
  await hist.click();
  mode = 'error';
  await hist.click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await shot(p, 'history-error');
  mode = 'empty';
  await panel.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(panel.getByText('Бесед пока нет.')).toBeVisible();
  await shot(p, 'history-empty');
  await hist.click();
}
const errors: string[] = [];
for (const [version, port] of [
  ['after-complete', Number(process.env.BLOCK0_PORT ?? 4531)],
] as const) {
  const dest = path.join(root, version);
  await fs.mkdir(dest, { recursive: true });
  for (const width of [1440, 390]) {
    async function pageFor(mode = 'normal') {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: 'reduce',
        isMobile: width === 390,
        hasTouch: width === 390,
      });
      await mockSignedInCabinet(page);
      await page.addInitScript(() =>
        localStorage.setItem('openqareer_session_token', 'synthetic-block0-review'),
      );
      if (mode === 'wizard')
        await page.route('**/api/v1/candidate/workspace', (r) =>
          r.fulfill({ json: { data: null } }),
        );
      if (mode === 'login')
        await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: { data: null } }));
      if (mode === 'normal') {
        await page.route('**/api/v1/candidate/me?*', (r) =>
          r.fulfill({ json: { data: { ...candidateSnapshot, messages } } }),
        );
        await page.route('**/api/v1/candidate/me/messages?*', (r) =>
          r.fulfill({ json: { data: messages, meta: { nextOffset: null } } }),
        );
      }
      await page.goto(`http://127.0.0.1:${port}/${mode === 'login' ? 'login' : 'app'}`, {
        waitUntil: 'domcontentloaded',
      });
      if (mode !== 'login')
        await expect(page.locator('.career-shell')).toBeVisible({ timeout: 20000 });
      if (mode !== 'login')
        await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/, {
          timeout: 20000,
        });
      if (mode === 'normal') {
        await expect(
          page.locator(
            width === 1440
              ? '.career-today-queue-count'
              : '.career-today-mobile .tm-hero:not(.today-loading-hero)',
          ),
        ).toBeVisible({ timeout: 20000 });
      }
      return page;
    }
    async function shot(page: Page, name: string) {
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return document.fonts.ready;
      });
      await page.mouse.move(0, 0);
      const target = path.join(dest, `${name}-${width}.png`);
      if (name !== 'login')
        await captureCareerHarness(page, path.join(dest, `${name}-${width}.html`));
      await page.screenshot({ path: target, fullPage: true, animations: 'disabled' });
      await captureScrollableScreen(page, dest, name, width);
      console.log(version, width, name);
    }
    async function scenario(name: string, fn: () => Promise<void>) {
      try {
        await fn();
      } catch (e) {
        errors.push(`${version}/${width}/${name}: ${String(e)}`);
        console.error(errors.at(-1));
      }
    }
    await scenario('wizard', async () => {
      const p = await pageFor('wizard');
      await expect(p.getByTestId('first-run-wizard')).toBeVisible({ timeout: 15000 });
      if (width === 1440)
        await expect(
          p.getByRole('button', { name: 'Можно без LinkedIn?', exact: true }),
        ).toBeVisible();
      if (await p.getByTestId('edit-goal-btn').isVisible())
        await p.getByTestId('edit-goal-btn').click();
      await p
        .getByTestId('goal-textarea')
        .fill('Хочу понять, на какие руководящие роли могу идти. Ищу активно.');
      await shot(p, 'goal');
      await p.getByTestId('save-goal-btn').click();
      await shot(p, 'source');
      await advanceFirstRunSource(p, width === 390, async () => shot(p, 'skip-confirm'));
      await expect(p.getByTestId('context-city-picker-btn')).toBeVisible();
      await shot(p, 'context');
      await p.getByTestId('context-city-picker-btn').click();
      await expect(p.getByTestId('first-run-city-sheet')).toBeVisible();
      await shot(p, 'city-picker');
      await p.getByTestId('city-item-Москва').click();
      await p.getByTestId('context-format-select').selectOption('Гибрид');
      await shot(p, 'context-filled');
      await p.getByTestId('context-city-picker-btn').click();
      await shot(p, 'city-picker-selected');
      await p.close();
    });
    await scenario('shell', async () => {
      const p = await pageFor();
      const panel = p.locator('.career-expert-panel');
      if (width === 390) {
        await shot(p, 'shell-closed');
        await p.getByRole('button', { name: 'Консультант: открыть', exact: true }).click();
      } else if (await panel.getByRole('button', { name: /^Развернуть консультанта/ }).isVisible())
        await panel.getByRole('button', { name: /^Развернуть консультанта/ }).click();
      await expect(panel.getByLabel('Сообщение карьерному консультанту')).toBeVisible();
      await shot(p, 'consultant-open');
      await captureHistory(p, shot);
      if (width === 390) {
        await p.keyboard.press('Escape');
        await shot(p, 'consultant-strip');
        await p.getByRole('button', { name: 'Ещё', exact: true }).click();
        await shot(p, 'more-menu');
        await p.close();
        return;
      }
      if (width === 1440) {
        await panel
          .getByRole('button', { name: 'Свернуть консультанта в полосу', exact: true })
          .click();
        await shot(p, 'consultant-strip');
      } else {
        await p.keyboard.press('Escape');
        await shot(p, 'consultant-strip');
        await p.getByRole('button', { name: 'Ещё', exact: true }).click();
        await shot(p, 'more-menu');
      }
      await p.close();
    });
    await scenario('login', async () => {
      const p = await pageFor('login');
      await expect(p.getByRole('button', { name: 'Войти в кабинет', exact: true })).toBeVisible({
        timeout: 15000,
      });
      await shot(p, 'login');
      await p.close();
    });
    await scenario('boot', async () => {
      const p = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: 'reduce',
      });
      await mockSignedInCabinet(p);
      let release!: () => void;
      const pending = new Promise<void>((r) => (release = r));
      await p.route('**/api/v1/auth/me', async (r) => {
        await pending;
        await r.fallback();
      });
      await p.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'domcontentloaded' });
      await expect(p.locator('.career-today-skeleton-card').first()).toBeVisible({
        timeout: 15000,
      });
      await shot(p, 'session-loading');
      release();
      await p.close();
    });
  }
}
await browser.close();
await fs.writeFile(path.join(root, 'capture-errors.json'), JSON.stringify(errors, null, 2));
if (errors.length) process.exitCode = 1;
