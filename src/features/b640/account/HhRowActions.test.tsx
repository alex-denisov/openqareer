// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { ConnectionsScreen } from './ConnectionsScreen';

const api = vi.hoisted(() => ({
  getConnections: vi.fn(),
  inApp: vi.fn(() => true),
  readHhResumeList: vi.fn(),
  chooseHhResume: vi.fn(),
  refreshHhProfile: vi.fn(),
}));
vi.mock('../../coach/coachApi', async (original) => ({
  ...(await original<typeof import('../../coach/coachApi')>()),
  getConnections: api.getConnections,
}));
vi.mock('../../account/notificationPreferencesApi', () => ({
  getNotificationChannelStatus: async () => ({ telegram: { available: false } }),
}));
vi.mock('./hhSessionApi', () => ({ getHhSessionState: async () => ({ expired: false }) }));
vi.mock('../../../services/desktop/desktopBridge', async (original) => ({
  ...(await original<typeof import('../../../services/desktop/desktopBridge')>()),
  isTauriEnvironment: api.inApp,
}));
vi.mock('./hhResumeSession', () => ({
  readHhResumeList: api.readHhResumeList,
  chooseHhResume: api.chooseHhResume,
  refreshHhProfile: api.refreshHhProfile,
}));

const session: AuthUser = {
  username: 'flagged.test',
  email: 'm.sokolova@mail.test',
  displayName: 'Марина Соколова',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-1',
  features: { cabinetB640: true },
  emailVerified: true,
};
const hh = {
  platform: 'hh',
  available: true,
  capabilities: [],
  importsCareerHistory: true,
  status: 'connected',
  accessMode: 'native_session_snapshot',
  connectedAt: '2026-11-10T09:00:00.000Z',
  lastImportedAt: '2026-11-03T06:12:00.000Z',
  factCount: 12,
};
const resumes = [
  { id: 'r1', title: 'Руководитель разработки', url: 'https://hh.ru/resume/r1' },
  { id: 'r2', title: 'CTO', url: 'https://hh.ru/resume/r2', updatedLabel: 'обновлено 3 ноября' },
];

let view: Mounted | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function open(): Promise<HTMLElement> {
  const value = {
    session,
    path: '/app/account/connections',
    search: '',
    match: null,
    consultantRoute: null,
    navigate: vi.fn(),
    signOut: vi.fn(async () => undefined),
    theme: 'light' as const,
    setTheme: () => undefined,
  };
  view = mount(
    <ShellProvider value={value}>
      <ConnectionsScreen node={nodeByCode('n03')!} />
    </ShellProvider>,
  );
  await settle();
  return view.container;
}

function menuItem(root: HTMLElement, text: string): Element | undefined {
  return [...root.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === text);
}

const result = (root: HTMLElement) => root.querySelector('.cn-row .set-l .res-row')?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  api.inApp.mockReturnValue(true);
  api.getConnections.mockResolvedValue([hh]);
  api.readHhResumeList.mockResolvedValue({ kind: 'ready', resumes, selectedId: 'r2' });
  api.refreshHhProfile.mockResolvedValue(undefined);
  api.chooseHhResume.mockResolvedValue(undefined);
});
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

describe('n03, строка hh.ru: «Обновить сейчас» и «Сменить резюме» (B774)', () => {
  it('в вебе пунктов нет: резюме читаются только в приложении', async () => {
    api.inApp.mockReturnValue(false);
    const root = await open();
    expect(menuItem(root, 'Обновить сейчас')).toBeUndefined();
    expect(menuItem(root, 'Сменить резюме')).toBeUndefined();
    expect(menuItem(root, 'Отключить')).toBeDefined();
  });

  it('«Обновить сейчас» читает выбранное резюме, итог на месте, список перечитан', async () => {
    const root = await open();
    click(menuItem(root, 'Обновить сейчас') ?? null);
    await settle();
    expect(api.refreshHhProfile).toHaveBeenCalledWith(resumes, 'r2');
    expect(result(root)).toContain('Профиль обновлён из hh.ru');
    expect(api.getConnections).toHaveBeenCalledTimes(2);
  });

  it('нет входа в hh.ru — так и сказано, с кнопкой входа', async () => {
    api.readHhResumeList.mockResolvedValue({ kind: 'signin', selectedId: null });
    const root = await open();
    click(menuItem(root, 'Обновить сейчас') ?? null);
    await settle();
    expect(api.refreshHhProfile).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Нужен вход в hh.ru');
    expect(root.querySelector('.res-act')?.textContent).toBe('Войти в hh.ru');
  });

  it('сбой обновления — ошибка на месте и «Повторить»', async () => {
    api.refreshHhProfile.mockRejectedValueOnce(new Error('hh_resume_not_read'));
    const root = await open();
    click(menuItem(root, 'Обновить сейчас') ?? null);
    await settle();
    expect(root.querySelector('.set-res.is-err span')?.textContent).toBe(
      'Профиль из hh.ru не обновился',
    );
    click(root.querySelector('.set-res.is-err button'));
    await settle();
    expect(result(root)).toContain('Профиль обновлён из hh.ru');
  });

  it('«Сменить резюме»: список с отмеченным текущим, выбор сохраняется, итог на месте', async () => {
    const root = await open();
    click(menuItem(root, 'Сменить резюме') ?? null);
    await settle();
    const radios = [
      ...document.querySelectorAll<HTMLInputElement>('.hh2-pick input[type="radio"]'),
    ];
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
    click(radios[0]);
    const confirm = [...document.querySelectorAll('button')].find(
      (item) => item.textContent === 'Подтвердить',
    );
    click(confirm ?? null);
    await settle();
    expect(api.chooseHhResume).toHaveBeenCalledWith(resumes, resumes[0]);
    expect(result(root)).toContain('Резюме для откликов: Руководитель разработки');
  });
});
