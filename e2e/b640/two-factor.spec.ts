import { expect, test, type Page, type Route } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { account, candidate } from '../fixtures/readabilityWorkspace';
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
}, testInfo) => {
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
  // B754: поля 295, как в макете n04d; на 390 в закреплённой панели только «Включить».
  const field = (await screen.getByLabel('Текущий пароль').boundingBox())!;
  expect(Math.round(field.width)).toBe(295);
  const dock = screen.locator('.actions.m-commit');
  await expect(dock.getByRole('button')).toHaveText(['Включить']);
  if (testInfo.project.name === 'mobile-390') {
    const cancel = (await screen.getByRole('button', { name: 'Отмена' }).boundingBox())!;
    expect(cancel.y).toBeGreaterThan(field.y);
    expect(Math.round((await dock.getByRole('button').boundingBox())!.width)).toBe(358);
  }
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
  // B754: «Скачать» — контурная кнопка в строке с «Готово», под «Скопировать коды», на 1440 и 390.
  expect(Math.round(download.height)).toBe(44);
  const copyCodes = (await screen.getByRole('button', { name: 'Скопировать коды' }).boundingBox())!;
  expect(Math.round(done.y)).toBe(Math.round(download.y));
  expect(download.y).toBeGreaterThan(copyCodes.y);
  await expect(screen.getByRole('button', { name: 'Скачать' })).toHaveClass(/\bbtn\b/u);
  if (testInfo.project.name === 'mobile-390') {
    expect(Math.round(copyCodes.width)).toBe(332);
  } else {
    // Ширина по тексту: шрифты Linux-раннера дают на 2 px уже — допуск 2 px.
    expect(Math.abs(download.width - 125)).toBeLessThanOrEqual(2);
  }
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

// B755: «Вход по Touch ID / Face ID» в n04. Сервер подменён, а системное окно — настоящее:
// виртуальный аутентификатор Chromium отвечает на navigator.credentials.create.
// RP ID не бывает IP-адресом, поэтому страница открывается по localhost.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const THIS_MAC = 'MacBook · Safari';

interface PasskeyServer {
  keys: { id: string; deviceLabel: string | null; createdAt: string; lastUsedAt: string | null }[];
  optionBodies: { password?: string; code?: string }[];
  registrations: { token: string; response: { id: string } }[];
}

const creationOptions = {
  challenge: 'YWJjZGVmZ2hpamtsbW5vcA',
  rp: { name: 'openqareer', id: 'localhost' },
  user: { id: 'dXNlci0x', name: 'candidate', displayName: 'candidate' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  attestation: 'none',
  timeout: 60_000,
};

async function mockPasskeys(page: Page): Promise<PasskeyServer> {
  const server: PasskeyServer = { keys: [], optionBodies: [], registrations: [] };
  await mockTwoFactor(page);
  await page.route(
    (url) => url.pathname === '/api/v1/account',
    (route) =>
      route.request().method() === 'GET'
        ? json(route, { ...account, sessions: [{ ...account.sessions[0], deviceLabel: THIS_MAC }] })
        : route.fallback(),
  );
  await page.route('**/api/v1/account/passkeys**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') return json(route, { passkeys: server.keys });
    if (path.endsWith('/options')) {
      server.optionBodies.push(request.postDataJSON() as { password?: string });
      return json(route, { options: creationOptions, token: 'oqp_e2e_token' });
    }
    server.registrations.push(
      request.postDataJSON() as { token: string; response: { id: string } },
    );
    server.keys = [
      { id: 'k1', deviceLabel: THIS_MAC, createdAt: '2026-11-22T10:00:00.000Z', lastUsedAt: null },
    ];
    return json(route, { id: 'k1' });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return server;
}

test('B755: Touch ID / Face ID — строка в «Вход», добавление устройства, гейты', async ({
  page,
}) => {
  const server = await mockPasskeys(page);
  await page.goto(`http://localhost:${PORT}/app/account/security`, {
    waitUntil: 'domcontentloaded',
  });
  const screen = page.locator('[data-b640-node="n04"]');
  const row = screen.locator('.set-row', { hasText: 'Вход по Touch ID / Face ID' });
  await expect(row.locator('.set-t')).toBeVisible();
  await expect(row.locator('.set-v')).toHaveText('выключено');
  await expect(row.getByRole('button', { name: 'Добавить устройство' })).toBeVisible();
  await expectGates(page);

  await row.getByRole('button', { name: 'Добавить устройство' }).click();
  const form = screen.locator('form.c5-form');
  await expect(form.getByLabel('Текущий пароль')).toBeVisible();
  await expect(form.getByLabel('Код из приложения-аутентификатора')).toHaveCount(0);
  await expectGates(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await form.getByLabel('Текущий пароль').fill('secret-password');
  await form.getByRole('button', { name: 'Добавить' }).click();
  await expect(row.locator('.set-v')).toHaveText('включено на этом Mac');
  await expect(form).toHaveCount(0);
  expect(server.optionBodies).toEqual([{ password: 'secret-password' }]);
  expect(server.registrations).toHaveLength(1);
  expect(server.registrations[0]?.token).toBe('oqp_e2e_token');
  expect(server.registrations[0]?.response.id).toEqual(expect.any(String));
  await expectGates(page);
});
