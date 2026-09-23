// Общий помощник шага CJM: снимок на 1440 и 390, текст экрана, ошибки
// консоли/страницы/сети. Каждый CJM-скрипт вызывает newStepRecorder() один
// раз и step() на каждом значимом экране пути.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { BASE_URL } from './env.mjs';

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844, isMobile: true, hasTouch: true },
];

/**
 * Ведёт один проход CJM по двум ширинам одновременно (два браузерных
 * контекста из одного storageState, синхронные переходы). Возвращает
 * {browser, drive, steps, close} — drive(fn) выполняет fn(page, viewportName)
 * для каждой ширины по очереди на том же URL.
 */
export async function openCjmRun(cjmId, statePath, outDir) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const contexts = {};
  const pages = {};
  const problems = { 1440: [], 390: [] };

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      storageState: statePath,
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
    });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') problems[vp.name].push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems[vp.name].push(`page: ${e.message}`));
    page.on('requestfailed', (r) => {
      problems[vp.name].push(`request: ${r.method()} ${r.url()} — ${r.failure()?.errorText}`);
    });
    contexts[vp.name] = context;
    pages[vp.name] = page;
  }

  const steps = [];

  /** goto(path) на обеих ширинах. */
  async function gotoBoth(path, wait = 3000) {
    for (const vp of VIEWPORTS) {
      await pages[vp.name].goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
    }
    await Promise.all(VIEWPORTS.map(() => new Promise((r) => setTimeout(r, wait))));
  }

  /**
   * Снимает шаг: имя, что делали на 1440 и 390 (through-away `act(page, vp)`
   * — необязательный, по умолчанию ничего не делает, только снимок текущего
   * состояния), результат — файлы <n>-<step>-<vp>.png и запись в steps[].
   */
  async function step(name, opts = {}) {
    const { act = null, wait = 1500, fullPage = false } = opts;
    const record = { name, shots: {}, text: {}, errors: {}, note: opts.note ?? null };
    for (const vp of VIEWPORTS) {
      const page = pages[vp.name];
      if (act) {
        try {
          await act(page, vp.name);
        } catch (e) {
          record.errors[vp.name] = [...(record.errors[vp.name] ?? []), `act: ${e.message.split('\n')[0]}`];
        }
      }
      await page.waitForTimeout(wait);
      const file = join(outDir, `${String(steps.length + 1).padStart(2, '0')}-${name}-${vp.name}.png`);
      await page.screenshot({ path: file, fullPage }).catch((e) => {
        record.errors[vp.name] = [...(record.errors[vp.name] ?? []), `screenshot: ${e.message.split('\n')[0]}`];
      });
      record.shots[vp.name] = file;
      record.text[vp.name] = await page
        .evaluate(() => (document.querySelector('main') ?? document.body).innerText.slice(0, 4000))
        .catch(() => '');
    }
    steps.push(record);
    console.log(`[${cjmId}] шаг «${name}» снят (1440, 390)`);
    return record;
  }

  async function close() {
    for (const vp of VIEWPORTS) await contexts[vp.name].close();
    await browser.close();
    return { steps, consoleErrors: problems };
  }

  return { pages, gotoBoth, step, close };
}
