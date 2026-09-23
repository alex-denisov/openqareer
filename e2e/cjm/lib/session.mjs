// Вход один раз на роль, дальше — переиспользование storageState.
// Вход ограничен по частоте (3 подряд → 429 на 11 минут), поэтому этот модуль
// логинится только когда сохранённого состояния ещё нет, и никогда молча не
// повторяет вход при сбое проверки.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { credentialsFor, BASE_URL } from './env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(HERE, '..', '.state');

function statePathFor(role) {
  return join(STATE_DIR, `${role}.json`);
}

/**
 * Возвращает путь к storageState для роли, логинясь только если файла ещё нет
 * (или force=true). Анонимный /api/v1/auth/me отвечает 200 с data:null —
 * проверка входа читает именно data, а не код ответа.
 */
export async function ensureSession(role, { force = false } = {}) {
  mkdirSync(STATE_DIR, { recursive: true });
  const statePath = statePathFor(role);

  if (!force && existsSync(statePath)) {
    const ok = await verifySession(statePath);
    if (ok) return statePath;
    console.log(`[session] сохранённая сессия «${role}» невалидна, перелогин`);
  }

  const { username, password } = credentialsFor(role);
  if (!username || !password) {
    throw new Error(`в env-файле нет учётной записи для роли «${role}»`);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-identifier', username);
  await page.fill('#login-password', password);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    page.click('button.auth-submit-btn'),
  ]);
  await page.waitForTimeout(3000);

  const url = page.url();
  if (url.includes('/login')) {
    const message = await page.locator('[role="alert"]').first().textContent().catch(() => null);
    await browser.close();
    throw new Error(`вход под ролью «${role}» не удался: ${message ?? '(без сообщения формы)'}`);
  }

  await context.storageState({ path: statePath });
  await browser.close();
  console.log(`[session] «${role}»: вход выполнен, storageState сохранён в ${statePath}`);
  return statePath;
}

async function verifySession(statePath) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/app`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const signedIn = await page
    .evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      const body = await res.json().catch(() => null);
      return Boolean(body && body.data);
    })
    .catch(() => false);
  await browser.close();
  return signedIn;
}

export { BASE_URL, STATE_DIR };
