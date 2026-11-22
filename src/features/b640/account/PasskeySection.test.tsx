// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../coach/apiClient';
import type { AuthUser } from '../../coach/coachApi';
import { mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { passkeyStatus } from './PasskeySection';
import { SecurityScreen } from './SecurityScreen';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  options: vi.fn(),
  register: vi.fn(),
  twoFactor: vi.fn(),
  start: vi.fn(),
  supported: vi.fn(() => true),
}));
vi.mock('./passkeyApi', () => ({
  listPasskeys: api.list,
  requestPasskeyOptions: api.options,
  registerPasskey: api.register,
}));
vi.mock('./twoFactorApi', () => ({ getTwoFactorStatus: api.twoFactor }));
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: api.start,
  browserSupportsWebAuthn: api.supported,
}));
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
        deviceLabel: 'MacBook · Safari',
      },
    ],
  }),
}));

const session = {
  username: 'f.test',
  role: 'candidate',
  isTest: true,
  candidateId: 'c',
  features: { cabinetB640: true },
  emailVerified: true,
} as AuthUser;
const KEY = {
  id: 'k1',
  deviceLabel: 'MacBook · Safari',
  createdAt: '2026-11-20T10:00:00.000Z',
  lastUsedAt: null,
};
const OPTIONS = { options: { challenge: 'abc' }, token: 'oqp_token' };

let view: Mounted | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  api.supported.mockReturnValue(true);
  api.list.mockResolvedValue([]);
  api.twoFactor.mockResolvedValue({ enabled: false, backupCodesLeft: 0 });
  api.options.mockResolvedValue(OPTIONS);
  api.start.mockResolvedValue({ id: 'cred' });
  api.register.mockResolvedValue(undefined);
});
afterEach(() => {
  view?.unmount();
  view = null;
});

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

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
const row = (root: HTMLElement) =>
  [...root.querySelectorAll('.set-row')].find((item) =>
    item.textContent?.includes('Touch ID / Face ID'),
  ) ?? null;
const field = (root: HTMLElement, label: string) => {
  const found = [...root.querySelectorAll('label')].find((item) => item.textContent === label);
  return found ? root.ownerDocument.getElementById(found.htmlFor) : null;
};

async function fillAndAdd(root: HTMLElement) {
  act(() => button(root, 'Добавить устройство')?.click());
  type(field(root, 'Текущий пароль'), 'secret-password');
  await act(async () => {
    button(root, 'Добавить')?.click();
    await new Promise((done) => setTimeout(done, 0));
  });
}

describe('passkeyStatus', () => {
  it('this device has a key → mockup wording; otherwise off', () => {
    expect(passkeyStatus([KEY], 'MacBook · Safari')).toBe('включено на этом Mac');
    expect(passkeyStatus([{ ...KEY, deviceLabel: 'iPhone · Safari' }], 'iPhone · Safari')).toBe(
      'включено на этом iPhone',
    );
    expect(passkeyStatus([{ ...KEY, deviceLabel: 'Windows · Chrome' }], 'Windows · Chrome')).toBe(
      'включено на этом устройстве',
    );
    expect(passkeyStatus([KEY], 'iPhone · Safari')).toBe('выключено');
    expect(passkeyStatus([KEY], null)).toBe('выключено');
    expect(passkeyStatus([], 'MacBook · Safari')).toBe('выключено');
  });
});

describe('B755: Touch ID / Face ID в n04', () => {
  it('without a key on this device: «выключено» and «Добавить устройство»', async () => {
    const root = await open();
    expect(row(root)?.textContent).toContain('выключено');
    expect(button(row(root) as Element, 'Добавить устройство')).not.toBeNull();
  });

  it('with a key on this device: «включено на этом Mac»', async () => {
    api.list.mockResolvedValue([KEY]);
    expect((await open().then(row))?.textContent).toContain('включено на этом Mac');
  });

  it('the row is absent where the browser has no WebAuthn', async () => {
    api.supported.mockReturnValue(false);
    expect(row(await open())).toBeNull();
  });

  it('add: password → options → system dialog → register → list reloaded', async () => {
    const root = await open();
    api.list.mockResolvedValue([KEY]);
    await fillAndAdd(root);
    expect(api.options).toHaveBeenCalledWith({ password: 'secret-password', code: '' });
    expect(api.start).toHaveBeenCalledWith({ optionsJSON: OPTIONS.options });
    expect(api.register).toHaveBeenCalledWith('oqp_token', { id: 'cred' });
    await settle();
    expect(row(root)?.textContent).toContain('включено на этом Mac');
    expect(field(root, 'Текущий пароль')).toBeNull();
  });

  it('with 2FA on the form also asks for the code', async () => {
    api.twoFactor.mockResolvedValue({ enabled: true, backupCodesLeft: 8 });
    const root = await open();
    act(() => button(root, 'Добавить устройство')?.click());
    type(field(root, 'Текущий пароль'), 'secret-password');
    expect(button(root, 'Добавить')?.disabled).toBe(true);
    type(field(root, 'Код из приложения-аутентификатора'), '123456');
    expect(button(root, 'Добавить')?.disabled).toBe(false);
  });

  it('cancel in the system dialog changes nothing and shows nothing', async () => {
    const root = await open();
    api.start.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    await fillAndAdd(root);
    expect(api.register).not.toHaveBeenCalled();
    expect(root.querySelector('.set-res.is-err')).toBeNull();
    expect(row(root)?.textContent).toContain('выключено');
  });

  it('a failure shows a short line in place; a server sentence is shown as written', async () => {
    const root = await open();
    api.options.mockRejectedValue(
      new CoachApiError('Пароль указан неверно.', 'current_password_invalid', false),
    );
    await fillAndAdd(root);
    expect(root.querySelector('.set-res.is-err')?.textContent).toBe('Пароль указан неверно.');
    api.options.mockResolvedValue(OPTIONS);
    api.register.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => {
      button(root, 'Добавить')?.click();
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(root.querySelector('.set-res.is-err')?.textContent).toBe(
      'Не удалось добавить устройство',
    );
  });
});
