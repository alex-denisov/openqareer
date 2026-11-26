import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { candidateSnapshot } from '../fixtures/readabilityWorkspace';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const API = '**/api/v1/candidate';

/** Точка 1×1 в PNG: её отдаёт мок хранилища фото. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function change(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `ch-${index}`,
    actor: 'candidate',
    section: 'headline',
    kind: 'value',
    itemId: null,
    label: `Заголовок профиля ${index}`,
    previousText: 'Руководитель продукта',
    appliedText: 'Директор по продукту',
    createdAt: '2026-11-12T09:00:00.000Z',
    revertedAt: null,
    ...overrides,
  };
}

interface Mocks {
  readonly photo?: boolean;
  /** Профиль импортирован из LinkedIn с фото: есть «Взять из LinkedIn». */
  readonly linkedinPhoto?: boolean;
  /** «Фото в резюме» на сервере. */
  readonly inResume?: boolean;
  readonly income?: { current: number | null; expected: number | null };
  /** Ответ сервера на загрузку фото вместо успеха. */
  readonly uploadError?: { status: number; code: string; message: string };
}

interface Calls {
  readonly uploads: Array<Record<string, unknown>>;
  photoRemoved: number;
  readonly incomePuts: unknown[];
  readonly reapplied: string[];
  linkedinTaken: number;
  readonly inResumePuts: unknown[];
  readonly exports: Array<Record<string, unknown>>;
}

async function openCabinet(page: Page, path: string, mocks: Mocks = {}): Promise<Calls> {
  const calls: Calls = {
    uploads: [],
    photoRemoved: 0,
    incomePuts: [],
    reapplied: [],
    linkedinTaken: 0,
    inResumePuts: [],
    exports: [],
  };
  let photoMediaId: string | null = mocks.photo ? 'photo-1' : null;
  let inResume = mocks.inResume ?? true;
  const linkedin = mocks.linkedinPhoto ? { linkedinPhotoMediaId: 'photo-li' } : {};
  let income = mocks.income ?? { current: null, expected: null };
  const reverted = new Set(['ch-0']);
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route(`${API}/resume`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const base = candidateSnapshot.resume.draft;
    const withLinkedin = { ...base.candidate, ...linkedin };
    const candidate = photoMediaId ? { ...withLinkedin, photoMediaId } : withLinkedin;
    return route.fulfill({
      json: {
        data: {
          draft: { ...base, candidate },
          savedAt: null,
          projection: { evidenceSnapshot: [], excludedEvidenceIds: [] },
          evidenceFreshness: { valid: true, stale: [] },
        },
      },
    });
  });
  await page.route(`${API}/media/*`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );
  await page.route(`${API}/profile/photo`, (route) => {
    if (route.request().method() === 'DELETE') {
      calls.photoRemoved += 1;
      photoMediaId = null;
      return route.fulfill({ json: { data: { photoMediaId: null } } });
    }
    calls.uploads.push(route.request().postDataJSON());
    if (mocks.uploadError) {
      const { status, code, message } = mocks.uploadError;
      return route.fulfill({ status, json: { error: { code, message } } });
    }
    photoMediaId = `photo-${calls.uploads.length + 1}`;
    return route.fulfill({ json: { data: { photoMediaId } } });
  });
  await page.route(`${API}/resume-builder/export`, (route) => {
    calls.exports.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
  });
  await page.route(`${API}/profile/photo/linkedin`, (route) => {
    calls.linkedinTaken += 1;
    photoMediaId = 'photo-li';
    return route.fulfill({ json: { data: { photoMediaId } } });
  });
  await page.route(`${API}/profile/photo/resume`, (route) => {
    if (route.request().method() === 'PUT') {
      calls.inResumePuts.push(route.request().postDataJSON());
      inResume = route.request().postDataJSON().inResume;
    }
    return route.fulfill({ json: { data: { inResume } } });
  });
  await page.route(`${API}/profile/income`, (route) => {
    if (route.request().method() === 'PUT') {
      income = route.request().postDataJSON();
      calls.incomePuts.push(income);
    }
    return route.fulfill({ json: { data: income } });
  });
  await page.route(`${API}/profile/history**`, (route) => {
    const url = new URL(route.request().url());
    const reapply = url.pathname.match(/history\/([^/]+)\/reapply$/u);
    if (reapply) {
      calls.reapplied.push(reapply[1]);
      reverted.delete(reapply[1]);
      return route.fulfill({ json: { data: { reapplied: true } } });
    }
    const entries = [
      change(0),
      change(1),
      change(2, {
        section: 'income',
        label: 'Доход сейчас',
        previousText: '',
        appliedText: '440 000 ₽',
      }),
    ].map((entry) =>
      reverted.has(entry.id) ? { ...entry, revertedAt: '2026-11-13T09:00:00.000Z' } : entry,
    );
    return route.fulfill({
      json: { data: { entries, total: entries.length, page: 0, pageSize: 20 } },
    });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
  return calls;
}

const node = (page: Page, code: string) => page.locator(`[data-b640-node="${code}"]`);
/** Настоящая картинка: экран открывает её и пересобирает перед отправкой. */
const photoFile = { name: 'me.png', mimeType: 'image/png', buffer: PIXEL };

test.describe('B666: «Фото» (p08)', () => {
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Фото профиля' });

  test('окно над «Профилем»: фото видно сразу, уходит по «Сохранить», шапка обновлена; гейты', async ({
    page,
  }) => {
    const calls = await openCabinet(page, '/app/profile/photo');
    const photo = dialog(page);
    // Под окном — сам профиль, как в макете p08.
    await expect(node(page, 'p08').locator('.phead')).toBeVisible();
    await expect(photo.getByText('Фото пока нет')).toBeVisible();
    await expect(photo.getByRole('button', { name: 'Убрать фото' })).toHaveCount(0);
    await expect(photo.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await expectGates(page);

    await photo.locator('input[type="file"]').setInputFiles(photoFile);
    await expect(photo.locator('img.ph-big')).toBeVisible();
    expect(calls.uploads).toHaveLength(0);
    await photo.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Фото обновлено')).toBeVisible();
    await expect(photo).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/profile$/u);
    expect(calls.uploads).toHaveLength(1);
    // Уходит пересобранный JPEG, а не исходный файл: без имени, типа и метаданных.
    const sent = Buffer.from(String(calls.uploads[0].contentBase64), 'base64');
    expect(Object.keys(calls.uploads[0])).toEqual(['contentBase64']);
    expect(sent.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    await expect(node(page, 's01').locator('img.phead-photo')).toBeVisible();
  });

  test('«Отмена» и Esc ничего не отправляют и возвращают в профиль', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/photo');
    await dialog(page).locator('input[type="file"]').setInputFiles(photoFile);
    await dialog(page).getByRole('button', { name: 'Отмена' }).click();
    await expect(page).toHaveURL(/\/app\/profile$/u);
    await page.goto('/app/profile/photo', { waitUntil: 'domcontentloaded' });
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/app\/profile$/u);
    expect(calls.uploads).toHaveLength(0);
  });

  test('сервер отклонил файл: причина в окне, окно открыто', async ({ page }) => {
    await openCabinet(page, '/app/profile/photo', {
      uploadError: { status: 400, code: 'photo_format', message: 'Подойдёт фото в JPEG или PNG.' },
    });
    const photo = dialog(page);
    await photo.locator('input[type="file"]').setInputFiles(photoFile);
    await photo.getByRole('button', { name: 'Сохранить' }).click();
    await expect(photo.getByRole('alert')).toContainText('Подойдёт фото в JPEG или PNG.');
    await expect(photo.getByRole('button', { name: 'Загрузить' })).toBeEnabled();
  });

  test('файл не открывается как картинка: причина в окне, на сервер ничего не ушло', async ({
    page,
  }) => {
    const calls = await openCabinet(page, '/app/profile/photo');
    const photo = dialog(page);
    await photo.locator('input[type="file"]').setInputFiles({
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    });
    await expect(photo.getByRole('alert')).toContainText('Файл не открылся как фото.');
    await expect(photo.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(calls.uploads).toHaveLength(0);
  });

  test('слишком тяжёлый файл не уходит на сервер', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/photo');
    const photo = dialog(page);
    await photo.locator('input[type="file"]').setInputFiles({
      ...photoFile,
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1),
    });
    await expect(photo.getByRole('alert')).toContainText('Фото больше 5 МБ.');
    expect(calls.uploads).toHaveLength(0);
  });

  test('фото можно убрать: по «Сохранить»', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/photo', { photo: true });
    const photo = dialog(page);
    await expect(photo.locator('img.ph-big')).toBeVisible();
    await photo.getByRole('button', { name: 'Убрать фото' }).click();
    await expect(photo.getByText('Фото пока нет')).toBeVisible();
    expect(calls.photoRemoved).toBe(0);
    await photo.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Фото убрано')).toBeVisible();
    expect(calls.photoRemoved).toBe(1);
  });

  test('«Взять из LinkedIn» ставит фото импорта по «Сохранить»', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/photo', {
      photo: true,
      linkedinPhoto: true,
    });
    const photo = dialog(page);
    const save = photo.getByRole('button', { name: 'Сохранить' });
    await expect(save).toBeDisabled();
    await photo.getByRole('button', { name: 'Взять из LinkedIn' }).click();
    expect(calls.linkedinTaken).toBe(0);
    await save.click();
    await expect(page.getByText('Фото обновлено')).toBeVisible();
    expect(calls.linkedinTaken).toBe(1);
    await expect(page).toHaveURL(/\/app\/profile$/u);
  });

  test('без импорта из LinkedIn кнопки нет', async ({ page }) => {
    await openCabinet(page, '/app/profile/photo', { photo: true });
    const photo = dialog(page);
    await expect(photo.getByRole('button', { name: 'Загрузить' })).toBeVisible();
    await expect(photo.getByRole('button', { name: 'Взять из LinkedIn' })).toHaveCount(0);
  });

  test('«Фото в резюме» включено по умолчанию, выключение уходит по «Сохранить»', async ({
    page,
  }) => {
    const calls = await openCabinet(page, '/app/profile/photo', { photo: true });
    const photo = dialog(page);
    const toggle = photo.getByRole('switch', { name: 'Фото в резюме' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    expect(calls.inResumePuts).toEqual([]);
    await photo.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByText('Сохранено')).toBeVisible();
    expect(calls.inResumePuts).toEqual([{ inResume: false }]);
    expect(calls.uploads).toEqual([]);
  });

  test('1440: окно 512 по центру, как в макете p08', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'только 1440');
    await openCabinet(page, '/app/profile/photo');
    const box = await dialog(page).boundingBox();
    expect([box?.x, box?.width].map((value) => Math.round(value ?? 0))).toEqual([464, 512]);
  });

  test('390: нижний лист во всю ширину', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'только 390');
    await openCabinet(page, '/app/profile/photo');
    const box = await dialog(page).boundingBox();
    const viewport = page.viewportSize();
    expect(Math.round(box?.width ?? 0)).toBe(viewport?.width);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height);
  });
});

test.describe('B666: «Фото в резюме» в «Резюме под роль» (s01)', () => {
  test('переключатель сохраняется сразу и показывает сохранённое', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile', { inResume: false });
    const resume = page.locator('section[aria-labelledby="cv-title"]');
    const toggle = resume.getByRole('switch', { name: 'Фото в резюме' });
    await expect(toggle).not.toBeChecked();
    await expect(resume.getByText('На hh.ru резюме с фото принято.')).toBeVisible();
    await toggle.click();
    await expect(toggle).toBeChecked();
    expect(calls.inResumePuts).toEqual([{ inResume: true }]);
  });

  test('«Скачать» отдаёт PDF резюме под роль, «Открыть» — тот же файл в новой вкладке', async ({
    page,
  }) => {
    const calls = await openCabinet(page, '/app/profile');
    const resume = page.locator('section[aria-labelledby="cv-title"]');
    const download = page.waitForEvent('download');
    await resume.getByRole('button', { name: /^Скачать резюме/u }).click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/u);
    expect(calls.exports[0]).toMatchObject({
      format: 'pdf',
      template: 'strict',
      profilePhoto: true,
    });

    const tab = page.context().waitForEvent('page');
    await resume.getByRole('button', { name: /^Открыть резюме/u }).click();
    // Вкладка открывается по нажатию; PDF в ней показывает просмотрщик браузера,
    // которого нет в headless Chromium, поэтому здесь — что вкладка есть и файл собран.
    expect(await tab).toBeTruthy();
    await expect.poll(() => calls.exports.length).toBe(2);
  });
});

test.describe('B673: доход и ожидания на «Профиле» (s01)', () => {
  test('строки видны только кандидату, правка в окне, ошибка у поля; гейты', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile');
    const job = node(page, 's01').locator('#sec-exp .job').first();
    await expect(job.getByText('видно только вам')).toBeVisible();
    await expect(job.getByText('Доход сейчас')).toBeVisible();
    await expect(
      node(page, 's01').locator('#sec-exp .job').nth(1).getByText('Доход сейчас'),
    ).toHaveCount(0);

    await job.getByRole('button', { name: 'Изменить' }).click();
    const dialog = page.getByRole('dialog', { name: 'Доход сейчас' });
    // Ожидания живут в «Условиях поиска», в карточке работы и окне их нет (B645 s01).
    await expect(job.getByText('Ожидания')).toHaveCount(0);
    await expect(dialog.getByLabel('Ожидания, ₽ в месяц на руки')).toHaveCount(0);
    await expectGates(page);
    await dialog.getByLabel('Доход сейчас, ₽ в месяц на руки').fill('много');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByText('Только число')).toBeVisible();
    expect(calls.incomePuts).toHaveLength(0);

    await dialog.getByLabel('Доход сейчас, ₽ в месяц на руки').fill('440 000');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(job.getByText('440 000 ₽ на руки', { exact: true })).toBeVisible();
    expect(calls.incomePuts).toEqual([{ current: 440000, expected: null }]);
  });

  test('сохранённый доход показан при открытии', async ({ page }) => {
    await openCabinet(page, '/app/profile', { income: { current: 440000, expected: null } });
    const job = node(page, 's01').locator('#sec-exp .job').first();
    await expect(job.getByText('440 000 ₽ на руки')).toBeVisible();
    // Не указана команда; строки «Ожидания» в карточке нет.
    await expect(job.getByText('Не указано')).toHaveCount(1);
  });
});

test.describe('B673: «Вернуть» в «Истории изменений» (p10)', () => {
  test('отменённую правку можно применить снова; у дохода нет «Отменить»', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/history');
    const rows = node(page, 'p10').locator('.hx-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('.hx-res')).toContainText('Отменено');
    await expect(rows.nth(2).getByRole('button', { name: /Отменить/u })).toHaveCount(0);
    await expectGates(page);

    await rows
      .nth(0)
      .getByRole('button', { name: /Вернуть: Заголовок профиля 0/u })
      .click();
    await expect(rows.nth(0).locator('.hx-res')).toHaveCount(0);
    await expect(rows.nth(0).getByRole('button', { name: /Отменить/u })).toBeVisible();
    expect(calls.reapplied).toEqual(['ch-0']);
  });
});

test.describe('B666, B673: снимки для сверки с макетами', () => {
  const SCREENS: readonly (readonly [string, string, Mocks])[] = [
    ['profile-photo', '/app/profile/photo', { photo: true }],
    [
      'profile-income',
      '/app/profile',
      { photo: true, income: { current: 440000, expected: 500000 } },
    ],
    ['profile-history-reverted', '/app/profile/history', {}],
  ];

  for (const [name, path, mocks] of SCREENS) {
    test(`снимки: ${name}`, async ({ page }, testInfo) => {
      test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
      mkdirSync('.s13-shots', { recursive: true });
      const desktop = testInfo.project.name === 'desktop-1440';
      const widths = desktop ? [1440, 1176] : [390];
      await openCabinet(page, path, mocks);
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.b640 .ls-skel, .b640 .ls-state')).toHaveCount(0);
        for (const width of widths) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    });
  }
});
