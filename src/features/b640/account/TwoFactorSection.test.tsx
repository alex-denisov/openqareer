// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../coach/apiClient';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { SecurityScreen } from './SecurityScreen';
import { groupedKey, keyLines } from './TwoFactorParts';

const api = vi.hoisted(() => ({
  status: vi.fn(),
  setup: vi.fn(),
  enable: vi.fn(),
  regenerate: vi.fn(),
  disable: vi.fn(),
  changePassword: vi.fn(),
  download: vi.fn(async () => null),
}));
vi.mock('./twoFactorApi', () => ({
  getTwoFactorStatus: api.status,
  startTwoFactorSetup: api.setup,
  enableTwoFactor: api.enable,
  regenerateBackupCodes: api.regenerate,
  disableTwoFactor: api.disable,
}));
vi.mock('../../resume/resumeExport', () => ({ triggerFileDownload: api.download }));
vi.mock('../../account/accountEmailChangeApi', () => ({
  getPendingAccountEmailChange: async () => null,
  requestAccountEmailChange: vi.fn(),
  verifyAccountEmailChange: vi.fn(),
}));
vi.mock('../../coach/coachApi', async (original) => ({
  ...(await original<typeof import('../../coach/coachApi')>()),
  getAccount: async () => ({
    username: 'f.test',
    email: 'm@mail.test',
    displayName: 'Марина',
    profile: { timezone: 'Europe/Moscow' },
    sessions: [
      {
        id: 'aaaaaaaaaaaaaaaa',
        current: true,
        createdAt: '2026-11-01T10:00:00.000Z',
        lastSeenAt: '2026-11-19T10:00:00.000Z',
        expiresAt: '2026-12-17T10:00:00.000Z',
      },
    ],
  }),
  changePassword: api.changePassword,
}));

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
const SETUP = {
  secret: 'JBSWY3DPEHPK3PXPK4ZQ7XWM',
  otpauthUrl:
    'otpauth://totp/openqareer:m%40mail.test?secret=JBSWY3DPEHPK3PXPK4ZQ7XWM&issuer=openqareer',
};
const session = {
  username: 'f.test',
  role: 'candidate',
  isTest: true,
  candidateId: 'c',
  features: { cabinetB640: true },
  emailVerified: true,
} as AuthUser;

let view: Mounted | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue({ enabled: false, backupCodesLeft: 0 });
});
afterEach(() => {
  view?.unmount();
  view = null;
});

async function settle() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function open(): Promise<HTMLElement> {
  const value = {
    session,
    path: '/app/account/security',
    search: '',
    match: null,
    consultantRoute: null,
    navigate: vi.fn(),
    signOut: async () => undefined,
    theme: 'light' as const,
    setTheme: () => undefined,
  };
  view = mount(
    <ShellProvider value={value}>
      <SecurityScreen node={nodeByCode('n04')!} />
    </ShellProvider>,
  );
  await settle();
  return view.container;
}

function type(input: Element | null | undefined, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((item) => item.textContent?.trim() === text) ?? null;
const field = (root: HTMLElement, label: string) => {
  const found = [...root.querySelectorAll('label')].find((item) => item.textContent === label);
  return found ? root.ownerDocument.getElementById(found.htmlFor) : null;
};
const headings = (root: HTMLElement) =>
  [...root.querySelectorAll('.set-h')].map((item) => item.textContent);

describe('keyLines', () => {
  it('секрет в 32 символа — две строки по четыре группы', () => {
    expect(keyLines('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')).toEqual([
      'ABCD EFGH IJKL MNOP',
      'QRST UVWX YZ23 4567',
    ]);
    expect(keyLines('JBSWY3DPEHPK3PXP')).toEqual(['JBSW Y3DP EHPK 3PXP']);
  });
});

describe('B401: двухфакторная защита в n04', () => {
  it('n04f: switched off — a row in «Вход» with «Включить»', async () => {
    const root = await open();
    const row = [...root.querySelectorAll('.set-row')].find((item) =>
      item.textContent?.includes('Двухфакторная защита'),
    );
    expect(row?.textContent).toContain('выключена');
    expect(button(row as Element, 'Включить')).not.toBeNull();
  });

  it('n04d → n04e: QR, key and code with password enable it; the 8 codes are shown once and «Готово» removes them', async () => {
    api.setup.mockResolvedValue(SETUP);
    api.enable.mockResolvedValue(CODES);
    const root = await open();
    await act(async () => click(button(root, 'Включить')));
    await settle();
    expect(headings(root)).toContain('Двухфакторная защита');
    expect(root.querySelector('svg.fa-qr[role="img"]')).not.toBeNull();
    // n04d на 390 (B645, 22.11): ключ в 8 групп не влезал в строку — строки по четыре группы.
    const lines = [...root.querySelectorAll('.fa-key code .fa-key-line')].map(
      (line) => line.textContent,
    );
    expect(lines).toEqual(['JBSW Y3DP EHPK 3PXP', 'K4ZQ 7XWM']);
    expect(lines.join(' ')).toBe(groupedKey(SETUP.secret));
    expect(root.textContent).not.toContain('выключена');
    type(field(root, 'Код из приложения-аутентификатора'), '123456');
    type(field(root, 'Текущий пароль'), 'secret-password');
    api.status.mockResolvedValue({ enabled: true, backupCodesLeft: 8 });
    await act(async () => click(button(root, 'Включить')));
    await settle();
    expect(api.enable).toHaveBeenCalledWith('123456', 'secret-password');
    expect([...root.querySelectorAll('.fa-codes code')].map((item) => item.textContent)).toEqual(
      CODES,
    );
    expect(headings(root)).toContain('Двухфакторная защита · включена');
    await act(async () => click(button(root, 'Скачать')));
    expect(api.download).toHaveBeenCalledWith(
      'openqareer-reserve-codes.txt',
      `${CODES.join('\n')}\n`,
      'text/plain',
    );
    await act(async () => click(button(root, 'Готово')));
    await settle();
    expect(root.querySelector('.fa-codes')).toBeNull();
    expect(root.textContent).not.toContain(CODES[0]);
    expect(JSON.stringify({ ...localStorage })).not.toContain(CODES[0]);
  });

  it('a wrong code keeps the form and says so in place', async () => {
    api.setup.mockResolvedValue(SETUP);
    api.enable.mockRejectedValue(new CoachApiError('Код не подошёл.', 'two_factor_invalid', false));
    const root = await open();
    await act(async () => click(button(root, 'Включить')));
    await settle();
    type(field(root, 'Код из приложения-аутентификатора'), '000000');
    type(field(root, 'Текущий пароль'), 'secret-password');
    await act(async () => click(button(root, 'Включить')));
    await settle();
    expect(root.textContent).toContain('Код не подошёл.');
    expect(root.querySelector('.fa-qr')).not.toBeNull();
  });

  it('switched on: new codes need a code, disabling asks first and then sends the code', async () => {
    api.status.mockResolvedValue({ enabled: true, backupCodesLeft: 6 });
    api.regenerate.mockResolvedValue(CODES);
    const root = await open();
    expect(root.textContent).toContain('включена · резервных кодов: 6');
    expect(button(root, 'Показать новые коды')?.hasAttribute('disabled')).toBe(true);
    type(field(root, 'Код из приложения-аутентификатора'), '654321');
    await act(async () => click(button(root, 'Показать новые коды')));
    await settle();
    expect(api.regenerate).toHaveBeenCalledWith('654321');
    expect(root.querySelectorAll('.fa-codes code')).toHaveLength(8);
    await act(async () => click(button(root, 'Готово')));
    await settle();
    type(field(root, 'Код из приложения-аутентификатора'), '111222');
    await act(async () => click(button(root, 'Отключить')));
    expect(api.disable).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Отключить двухфакторную защиту?');
    api.status.mockResolvedValue({ enabled: false, backupCodesLeft: 0 });
    await act(async () => click(button(dialog as Element, 'Отключить')));
    await settle();
    expect(api.disable).toHaveBeenCalledWith('111222');
    expect(root.textContent).toContain('выключена');
  });

  it('with 2FA on, changing the password asks for the code too', async () => {
    api.status.mockResolvedValue({ enabled: true, backupCodesLeft: 8 });
    api.changePassword.mockResolvedValue({});
    const root = await open();
    await act(async () => click(button(root, 'Сменить пароль')));
    type(field(root, 'Текущий пароль'), 'old-password-1');
    type(field(root, 'Новый пароль'), 'new-password-1');
    type(field(root, 'Повторите новый пароль'), 'new-password-1');
    expect(button(root, 'Сохранить пароль')?.hasAttribute('disabled')).toBe(true);
    const codes = [...root.querySelectorAll('label')].filter(
      (item) => item.textContent === 'Код из приложения-аутентификатора',
    );
    type(document.getElementById(codes[0]?.htmlFor ?? ''), '123456');
    await act(async () => click(button(root, 'Сохранить пароль')));
    await settle();
    expect(api.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password-1',
      newPassword: 'new-password-1',
      twoFactorCode: '123456',
    });
  });
});
