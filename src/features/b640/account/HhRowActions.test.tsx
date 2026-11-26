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
  getHhSessionState: vi.fn(),
  signInToHh: vi.fn(),
  inApp: vi.fn(() => true),
  readHhResumeList: vi.fn(),
  chooseHhResume: vi.fn(),
  refreshHhProfile: vi.fn(),
  refreshLinkedInProfile: vi.fn(),
  watchLinkedInNeedsPerson: vi.fn(),
  showLinkedInWindow: vi.fn(),
}));
vi.mock('../../coach/coachApi', async (original) => ({
  ...(await original<typeof import('../../coach/coachApi')>()),
  getConnections: api.getConnections,
}));
vi.mock('../../account/notificationPreferencesApi', () => ({
  getNotificationChannelStatus: async () => ({ telegram: { available: false } }),
}));
vi.mock('./hhSessionApi', () => ({ getHhSessionState: api.getHhSessionState }));
vi.mock('../apply/hh/hhDesktop', () => ({ signInToHh: api.signInToHh }));
vi.mock('../../../services/desktop/desktopBridge', async (original) => ({
  ...(await original<typeof import('../../../services/desktop/desktopBridge')>()),
  isTauriEnvironment: api.inApp,
}));
vi.mock('./linkedinSession', () => ({
  refreshLinkedInProfile: api.refreshLinkedInProfile,
  watchLinkedInNeedsPerson: api.watchLinkedInNeedsPerson,
  showLinkedInWindow: api.showLinkedInWindow,
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
  api.getHhSessionState.mockResolvedValue({ expired: false });
  api.readHhResumeList.mockResolvedValue({ kind: 'ready', resumes, selectedId: 'r2' });
  api.refreshHhProfile.mockResolvedValue(undefined);
  api.chooseHhResume.mockResolvedValue(undefined);
  api.watchLinkedInNeedsPerson.mockResolvedValue(() => undefined);
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

  it('B704: вход истёк — «Подключить» на месте; после входа данные обновлены, пометки нет', async () => {
    api.getHhSessionState.mockResolvedValue({ expired: true });
    let signedIn: (ok: boolean) => void = () => undefined;
    api.signInToHh.mockReturnValue(new Promise<boolean>((resolve) => { signedIn = resolve; }));
    const root = await open();
    const connect = root.querySelector('[aria-label="Подключить hh.ru"]');
    expect(connect?.textContent).toBe('Подключить');
    expect(root.querySelector('.cn-off')).toBeNull();
    expect(menuItem(root, 'Отключить')).toBeDefined();
    click(connect);
    await settle();
    expect(api.readHhResumeList).not.toHaveBeenCalled();
    api.getHhSessionState.mockResolvedValue({ expired: false });
    signedIn(true);
    await settle();
    expect(result(root)).toContain('Профиль обновлён из hh.ru');
    expect(root.querySelector('.set-v.is-warn')).toBeNull();
  });

  it('B704: вход снят, даже если сам профиль не обновился', async () => {
    api.getHhSessionState.mockResolvedValueOnce({ expired: true });
    api.refreshHhProfile.mockRejectedValue(new Error('сеть'));
    const root = await open();
    click(menuItem(root, 'Обновить сейчас') ?? null);
    await settle();
    expect(root.querySelector('.set-v.is-warn')).toBeNull();
    expect(root.textContent).toContain('Профиль из hh.ru не обновился');
  });

  it('B704: в вебе вход истёк — войти можно только в приложении, кнопки входа нет', async () => {
    api.inApp.mockReturnValue(false);
    api.getHhSessionState.mockResolvedValue({ expired: true });
    const root = await open();
    expect(root.querySelector('[aria-label="Подключить hh.ru"]')).toBeNull();
    expect(root.querySelector('.cn-off')).not.toBeNull();
  });

  it('капча hh.ru — «Открыть окно hh.ru», а не общий сбой', async () => {
    api.readHhResumeList.mockRejectedValueOnce(new Error('hh_captcha'));
    const root = await open();
    click(menuItem(root, 'Обновить сейчас') ?? null);
    await settle();
    expect(root.textContent).toContain('hh.ru просит пройти проверку');
    expect(root.textContent).toContain('Открыть окно hh.ru');
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

describe('n03, строка LinkedIn: «Обновить сейчас» (B645)', () => {
  const linkedin = { ...hh, platform: 'linkedin' };

  it('в приложении — «Обновить сейчас» без «Сменить резюме»; итог импорта на месте, список перечитан', async () => {
    api.getConnections.mockResolvedValue([linkedin]);
    api.refreshLinkedInProfile.mockResolvedValue({
      ok: true,
      message: 'Из LinkedIn сохранено 12 фактов.',
    });
    const root = await open();
    expect(menuItem(root, 'Сменить резюме')).toBeUndefined();
    click(menuItem(root, 'Обновить сейчас') ?? null);
    await settle();
    expect(api.refreshLinkedInProfile).toHaveBeenCalledTimes(1);
    expect(api.readHhResumeList).not.toHaveBeenCalled();
    expect(result(root)).toContain('Из LinkedIn сохранено 12 фактов.');
    expect(api.getConnections).toHaveBeenCalledTimes(2);
  });

  it('LinkedIn просит человека — окно открывает только кнопка', async () => {
    api.getConnections.mockResolvedValue([linkedin]);
    api.watchLinkedInNeedsPerson.mockImplementationOnce(async (onChange) => {
      onChange(true);
      return () => undefined;
    });
    api.refreshLinkedInProfile.mockReturnValue(new Promise(() => undefined));
    const root = await open();
    click(menuItem(root, 'Обновить сейчас') ?? null);
    await settle();
    expect(root.textContent).toContain('Нужен вход в LinkedIn');
    expect(api.showLinkedInWindow).not.toHaveBeenCalled();
    const button = [...root.querySelectorAll('button')].find((item) => item.textContent === 'Открыть окно');
    click(button ?? null);
    await settle();
    expect(api.showLinkedInWindow).toHaveBeenCalledOnce();
  });

  it('импорт не вышел — его объяснение на месте и «Повторить»', async () => {
    api.getConnections.mockResolvedValue([linkedin]);
    api.refreshLinkedInProfile
      .mockResolvedValueOnce({
        ok: false,
        message: 'Окно LinkedIn закрыто, импорт не завершён. Профиль не изменился.',
      })
      .mockRejectedValueOnce(new Error('сеть'));
    const root = await open();
    click(menuItem(root, 'Обновить сейчас') ?? null);
    await settle();
    expect(root.querySelector('.set-res.is-err span')?.textContent).toBe(
      'Окно LinkedIn закрыто, импорт не завершён. Профиль не изменился.',
    );
    click(root.querySelector('.set-res.is-err button'));
    await settle();
    expect(root.querySelector('.set-res.is-err span')?.textContent).toBe(
      'Профиль из LinkedIn не обновился',
    );
    expect(api.getConnections).toHaveBeenCalledTimes(1);
  });

  it('в вебе пункта нет', async () => {
    api.inApp.mockReturnValue(false);
    api.getConnections.mockResolvedValue([linkedin]);
    const root = await open();
    expect(menuItem(root, 'Обновить сейчас')).toBeUndefined();
  });
});
