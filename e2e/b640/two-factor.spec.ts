import { expect, test, type Page, type Route } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { candidate } from '../fixtures/readabilityWorkspace';
import { expectGates } from './gates';

// B401: включение 2FA в n04 → резервные коды один раз → выход → вход с кодом
// из приложения и с резервным кодом. Сервер подменён: протокол проверяют
// server/auth/twoFactorRoutes.test.ts, здесь — путь кандидата по экранам.

// Как настоящий секрет: 20 байт base32 = 32 символа, 8 групп (generateTotpSecret).
const SECRET = 'JBSWY3DPEHPK3PXPK4ZQ7XWMABCDEFGH';
const APP_CODE = '123456';
const CODES = [
  'k7m2p-x9qtr',
  '4hvbn-3wzc8',
  'r2d6t-mq7ka',
  'p9xfe-5ujn2',
  'w3cs8-hk4vb',
  'z6ta2-ry9mp',
  'e8nq5-dg3xw',
  'u4jk7-ft2ch',
];

interface TwoFactorServer {
  enabled: boolean;
  signedIn: boolean;
  usedCodes: string[];
  secondSteps: { challenge: string; code: string }[];
}

const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, json: status === 200 ? { data } : { error: data } });

async function mockTwoFactor(page: Page): Promise<TwoFactorServer> {
  const server: TwoFactorServer = {
    enabled: false,
    signedIn: true,
    usedCodes: [],
    secondSteps: [],
  };
  await mockSignedInCabinet(page, { cabinetB640: true });
  const user = { ...candidate, emailVerified: true, features: { cabinetB640: true } };
  await page.route('**/api/v1/auth/me', (route) =>
    server.signedIn ? route.fallback() : json(route, null),
  );
  await page.route('**/api/v1/account/two-factor**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/setup')) {
      return json(route, {
        secret: SECRET,
        otpauthUrl: `otpauth://totp/openqareer:candidate?secret=${SECRET}&issuer=openqareer`,
      });
    }
    if (path.endsWith('/enable')) {
      const body = route.request().postDataJSON() as { code: string; password: string };
      if (body.code !== APP_CODE || !body.password)
        return json(route, { code: 'two_factor_invalid', message: 'Код не подошёл.' }, 400);
      server.enabled = true;
      return json(route, { enabled: true, backupCodes: CODES });
    }
    return json(route, {
      enabled: server.enabled,
      backupCodesLeft: CODES.length - server.usedCodes.length,
    });
  });
  await page.route('**/api/v1/auth/logout', (route) => {
    server.signedIn = false;
    return json(route, { signedOut: true });
  });
  await page.route('**/api/v1/auth/login', (route) =>
    server.enabled
      ? json(route, { twoFactorRequired: true, challenge: 'oq2_e2e' })
      : json(route, null, 401),
  );
  await page.route('**/api/v1/auth/login/two-factor', async (route) => {
    const body = route.request().postDataJSON() as { challenge: string; code: string };
    server.secondSteps.push(body);
    const backup = CODES.includes(body.code) && !server.usedCodes.includes(body.code);
    if (body.code !== APP_CODE && !backup)
      return json(route, { code: 'two_factor_invalid', message: 'Код не подошёл.' }, 400);
    if (backup) server.usedCodes.push(body.code);
    server.signedIn = true;
    return json(route, { ...user, sessionToken: 'synthetic-b401-session' });
  });
  return server;
}

async function signInWith(page: Page, code: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-identifier').fill('candidate');
  await page.locator('#login-password').fill('secret-password');
  await page.locator('form button[type="submit"]').click();
  const field = page.getByLabel('Код из приложения или резервный код');
  await expect(field).toBeVisible();
  await expect(page.locator('#login-password')).toHaveCount(0);
  await field.fill(code);
  await page.getByRole('button', { name: 'Войти в кабинет' }).click();
  await expect(page).toHaveURL(/\/app/u);
}

test('B401: enable 2FA, keep the codes once, sign in with an app code and a backup code', async ({
  page,
}) => {
  const server = await mockTwoFactor(page);
  await page.goto('/app/account/security', { waitUntil: 'domcontentloaded' });
  const screen = page.locator('[data-b640-node="n04"]');
  const row = screen.locator('.set-row', { hasText: 'Двухфакторная защита' });
  await expect(row.locator('.set-v')).toHaveText('выключена');
  await row.getByRole('button', { name: 'Включить' }).click();

  await expect(
    screen.getByRole('img', { name: 'QR-код для приложения-аутентификатора' }),
  ).toBeVisible();
  await expect(screen.locator('.fa-key .fa-key-line')).toHaveText([
    'JBSW Y3DP EHPK 3PXP',
    'K4ZQ 7XWM ABCD EFGH',
  ]);
  await expectGates(page);
  // n04d (B645, 22.11): ключ и кнопки не уходят за край, страница без прокрутки вбок.
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - window.innerWidth,
    copy:
      document.querySelector('.fa-key .icon-btn')!.getBoundingClientRect().right -
      window.innerWidth,
  }));
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.copy).toBeLessThanOrEqual(0);
  await screen.getByLabel('Код из приложения-аутентификатора').fill(APP_CODE);
  await screen.getByLabel('Текущий пароль').fill('secret-password');
  await screen.getByRole('button', { name: 'Включить' }).click();

  await expect(screen.locator('.fa-codes code')).toHaveText(CODES);
  await expectGates(page);
  // n04e (B645, 22.11): зоны клика «Скачать» и «Готово» не перекрываются.
  const download = (await screen.getByRole('button', { name: 'Скачать' }).boundingBox())!;
  const done = (await screen.getByRole('button', { name: 'Готово' }).boundingBox())!;
  const apart = done.x >= download.x + download.width || done.y >= download.y + download.height;
  expect(apart).toBe(true);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(CODES[0]);
  await screen.getByRole('button', { name: 'Готово' }).click();
  await expect(screen.locator('.fa-codes')).toHaveCount(0);
  await expect(row.locator('.set-v')).toHaveText('включена · резервных кодов: 8');

  await screen.getByRole('button', { name: 'Выйти из аккаунта' }).click();
  await expect.poll(() => server.signedIn).toBe(false);
  // Выход уводит на «/» полной загрузкой документа (граница аналитики, App.tsx):
  // `goto('/login')` поверх незавершённого перехода падал с net::ERR_ABORTED.
  await page.waitForURL((url) => url.pathname === '/', { waitUntil: 'domcontentloaded' });

  await signInWith(page, APP_CODE);
  await signInWith(page, CODES[2]);
  expect(server.secondSteps).toEqual([
    { challenge: 'oq2_e2e', code: APP_CODE },
    { challenge: 'oq2_e2e', code: CODES[2] },
  ]);
  expect(server.usedCodes).toEqual([CODES[2]]);
});
