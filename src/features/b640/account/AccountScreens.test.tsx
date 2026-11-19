// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../coach/apiClient';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { ConnectionsScreen } from './ConnectionsScreen';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';
import { SectionsScreen } from './SectionsScreen';
import { SecurityScreen } from './SecurityScreen';

const api = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getConnections: vi.fn(),
  disconnectConnection: vi.fn(),
  changePassword: vi.fn(),
  updateAccountProfile: vi.fn(),
  revokeAccountSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  getNotificationPreferences: vi.fn(),
  getNotificationChannelStatus: vi.fn(),
  updateNotificationPreference: vi.fn(),
  startTelegramLink: vi.fn(),
  disconnectTelegram: vi.fn(),
  getTelegramLinkState: vi.fn(),
  getAccountCapabilityConsents: vi.fn(),
  getCandidateBillingSummary: vi.fn(),
  getPendingAccountEmailChange: vi.fn(),
  getResumeStudio: vi.fn(),
  requestAccountEmailChange: vi.fn(),
  verifyAccountEmailChange: vi.fn(),
}));

vi.mock('../../coach/coachApi', async (original) => ({
  ...(await original<typeof import('../../coach/coachApi')>()),
  getAccount: api.getAccount,
  getConnections: api.getConnections,
  disconnectConnection: api.disconnectConnection,
  changePassword: api.changePassword,
  updateAccountProfile: api.updateAccountProfile,
  revokeAccountSession: api.revokeAccountSession,
  revokeOtherSessions: api.revokeOtherSessions,
}));
vi.mock('../../account/notificationPreferencesApi', () => ({
  getNotificationPreferences: api.getNotificationPreferences,
  getNotificationChannelStatus: api.getNotificationChannelStatus,
  updateNotificationPreference: api.updateNotificationPreference,
  startTelegramLink: api.startTelegramLink,
  disconnectTelegram: api.disconnectTelegram,
}));
vi.mock('./telegramStateApi', () => ({ getTelegramLinkState: api.getTelegramLinkState }));
vi.mock('../../account/accountCapabilityConsentApi', () => ({
  getAccountCapabilityConsents: api.getAccountCapabilityConsents,
}));
vi.mock('../../resume/resumeApi', () => ({ getResumeStudio: api.getResumeStudio }));
vi.mock('../../shell/candidateBillingApi', () => ({
  getCandidateBillingSummary: api.getCandidateBillingSummary,
}));
vi.mock('../../account/accountEmailChangeApi', () => ({
  getPendingAccountEmailChange: api.getPendingAccountEmailChange,
  requestAccountEmailChange: api.requestAccountEmailChange,
  verifyAccountEmailChange: api.verifyAccountEmailChange,
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

const now = Date.now();
const account = {
  username: 'flagged.test',
  email: 'm.sokolova@mail.test',
  displayName: 'Марина Соколова',
  profile: { headline: null, location: null, workMode: null, timezone: 'Europe/Moscow', updatedAt: null },
  sessions: [
    { id: 'aaaaaaaaaaaaaaaa', current: true, createdAt: '2026-11-01T10:00:00.000Z', lastSeenAt: new Date(now).toISOString(), expiresAt: '2026-12-17T10:00:00.000Z' },
    { id: 'bbbbbbbbbbbbbbbb', current: false, createdAt: '2026-11-02T10:00:00.000Z', lastSeenAt: '2026-11-03T18:40:00.000Z', expiresAt: '2026-12-17T10:00:00.000Z' },
  ],
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
const linkedin = { platform: 'linkedin', available: true, capabilities: [], importsCareerHistory: true, status: 'disconnected' };
const channels = (connected: boolean, available = true) => ({
  emailAvailable: true,
  telegram: { available, connected, linkedAt: null, botUsername: 'openqareer_bot' },
  mandatory: {},
});
const events = [
  { key: 'ev-reply', app: true, email: true, telegram: false },
  { key: 'ev-weekly-digest', app: false, email: true, telegram: false },
];

let view: Mounted | null = null;
const navigate = vi.fn();
const signOut = vi.fn(async () => undefined);

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function open(element: ReactElement): Promise<HTMLElement> {
  const value = {
    session,
    path: '/app/account',
    search: '',
    match: null,
    consultantRoute: null,
    navigate,
    signOut,
    theme: 'light' as const,
    setTheme: () => undefined,
  };
  view = mount(<ShellProvider value={value}>{element}</ShellProvider>);
  await settle();
  return view.container;
}

function type(input: Element | null, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const node = (code: string) => nodeByCode(code)!;

beforeEach(() => {
  vi.clearAllMocks();
  api.getAccount.mockResolvedValue(account);
  api.getConnections.mockResolvedValue([hh, linkedin]);
  api.getNotificationPreferences.mockResolvedValue(events);
  api.getNotificationChannelStatus.mockResolvedValue(channels(false));
  api.getTelegramLinkState.mockResolvedValue({ state: 'none', expiresAt: null, username: null });
  api.getAccountCapabilityConsents.mockResolvedValue([
    { id: 'c1', capability: 'profile_activity', versionId: 'v1', grantedAt: '2026-11-01', revokedAt: null },
    { id: 'c2', capability: 'digital_footprint', versionId: 'v1', grantedAt: '2026-11-01', revokedAt: '2026-11-05' },
  ]);
  api.getCandidateBillingSummary.mockResolvedValue({ currentPlan: 'pro', subscription: null, plans: [] });
  api.getPendingAccountEmailChange.mockResolvedValue(null);
  api.getResumeStudio.mockResolvedValue({ draft: { candidate: { photoMediaId: null } } });
});
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('n00 «Аккаунт»: разделы', () => {
  it('шесть разделов со ссылками и подписями по данным', async () => {
    const root = await open(<SectionsScreen node={node('n00')} />);
    expect(root.querySelector('.lead-title')?.textContent).toBe('Марина Соколова');
    const rows = [...root.querySelectorAll('.set-list > .set-row')].map((row) => [
      row.querySelector('a.set-t.set-a')?.getAttribute('href'),
      row.querySelector('.set-t')?.textContent,
      row.querySelector('.set-v')?.textContent ?? null,
    ]);
    expect(rows).toEqual([
      ['/app/account/security', 'Вход и безопасность', 'Пароль, 2 устройства'],
      ['/app/account/connections', 'Подключения', 'hh.ru подключён'],
      ['/app/account/notifications', 'Уведомления', 'В приложении и на почту'],
      ['/app/account/data', 'Согласия и данные', '1 согласие, выгрузка, удаление'],
      ['/app/account/app', 'Приложение', 'Тема и часовой пояс'],
      ['/app/account/billing', 'Подписка и платежи', 'Pro'],
    ]);
  });

  it('фото из профиля вместо буквы; фото нет или профиль не прочитался — буква', async () => {
    const first = await open(<SectionsScreen node={node('n00')} />);
    expect(first.querySelector('.acc-photo img')).toBeNull();
    expect(first.querySelector('.acc-photo .phead-ini')?.textContent).toBe('М');
    view?.unmount();
    api.getResumeStudio.mockResolvedValue({ draft: { candidate: { photoMediaId: 'media-1' } } });
    const second = await open(<SectionsScreen node={node('n00')} />);
    const photo = second.querySelector('.acc-photo img.phead-photo') as HTMLImageElement;
    expect(photo.getAttribute('src')).toContain('/api/v1/candidate/media/media-1');
    expect(photo.alt).toBe('');
    expect(second.querySelector('.phead-ini')).toBeNull();
    view?.unmount();
    api.getResumeStudio.mockRejectedValue(new Error('сеть'));
    const third = await open(<SectionsScreen node={node('n00')} />);
    expect(third.querySelector('.acc-photo .phead-ini')?.textContent).toBe('М');
    expect(third.querySelectorAll('.set-list > .set-row')).toHaveLength(6);
  });

  it('сбой одного чтения не прячет разделы: подпись просто не показана', async () => {
    api.getConnections.mockRejectedValue(new Error('сеть'));
    const root = await open(<SectionsScreen node={node('n00')} />);
    const rows = [...root.querySelectorAll('.set-list > .set-row')];
    expect(rows).toHaveLength(6);
    expect(rows[1].querySelector('.set-v')).toBeNull();
    expect(rows[0].querySelector('.set-v')?.textContent).toBe('Пароль, 2 устройства');
  });
});

describe('n03 «Подключения»', () => {
  it('счёт подключений, почта, площадки и Telegram', async () => {
    const root = await open(<ConnectionsScreen node={node('n03')} />);
    expect(root.querySelector('.set-h')?.textContent).toBe('Подключено 2 из 4');
    const rows = [...root.querySelectorAll('.set-row.cn-row')].map((row) => [
      row.querySelector('.set-t')?.textContent,
      row.querySelector('.set-v')?.textContent ?? null,
    ]);
    expect(rows).toEqual([
      ['Почта', 'm.sokolova@mail.test · подтверждена'],
      ['hh.ru', 'подключено'],
      ['LinkedIn', 'не подключено'],
      ['Telegram', null],
    ]);
    expect(root.querySelector('a[aria-label="Подключить Telegram"]')?.getAttribute('href')).toBe(
      '/app/account/notifications',
    );
    // У неподключённой площадки действий нет: вход на площадку — в приложении.
    expect(rows[2] && root.querySelectorAll('.cn-off')).toHaveLength(1);
    expect(root.querySelector('.cn-menu-t')?.textContent).toBe('Обновлено 3 ноября');
  });

  it('отключение подтверждается на месте; сбой показан там же, успех перечитывает список', async () => {
    const root = await open(<ConnectionsScreen node={node('n03')} />);
    click(root.querySelector('.cn-off'));
    const confirm = root.querySelector('.va-pop.cn-pop[role=dialog]') as HTMLElement;
    expect(confirm.querySelector('.va-pop-t')?.textContent).toBe('Отключить hh.ru?');
    // Пока открыто подтверждение, в строке одно действие (макет N3f).
    expect(root.querySelector('.cn-off')).toBeNull();
    api.disconnectConnection.mockRejectedValueOnce(new Error('сеть'));
    click(confirm.querySelector('.btn.is-danger'));
    await settle();
    expect(root.querySelector('.cn-pop .set-res.is-err')?.textContent).toBe('Не отключилось');
    // Сервер ответил, но подключение не снял — это тоже сбой, а не «отключено».
    api.disconnectConnection.mockResolvedValueOnce({ platform: 'hh', connectionRemoved: false });
    click(root.querySelector('.cn-pop .btn.is-danger'));
    await settle();
    expect(root.querySelector('.cn-pop .set-res.is-err')).not.toBeNull();
    api.disconnectConnection.mockResolvedValueOnce({ platform: 'hh', connectionRemoved: true });
    api.getConnections.mockResolvedValue([{ ...linkedin, platform: 'hh' }, linkedin]);
    click(root.querySelector('.cn-pop .btn.is-danger'));
    await settle();
    expect(api.disconnectConnection).toHaveBeenLastCalledWith('hh');
    expect(root.querySelector('.cn-pop')).toBeNull();
    expect(root.querySelector('.set-h')?.textContent).toBe('Подключено 1 из 4');
    expect(root.querySelector('.cn-off')).toBeNull();
  });

  it('«Оставить» закрывает подтверждение без запроса', async () => {
    const root = await open(<ConnectionsScreen node={node('n03')} />);
    click(root.querySelector('.cn-off'));
    click(root.querySelector('.cn-pop .row-act'));
    expect(root.querySelector('.cn-pop')).toBeNull();
    expect(api.disconnectConnection).not.toHaveBeenCalled();
  });

  it('список не загрузился: строка с «Повторить»', async () => {
    api.getConnections.mockRejectedValueOnce(new Error('сеть'));
    const root = await open(<ConnectionsScreen node={node('n03')} />);
    expect(root.querySelector('.set-res.is-err span')?.textContent).toBe('Подключения не загрузились');
    click(root.querySelector('.set-res.is-err .btn'));
    await settle();
    expect(root.querySelector('.set-h')?.textContent).toBe('Подключено 2 из 4');
  });
});

describe('n02 «Уведомления»', () => {
  it('таблица: все события сервера по каналам, без строк без механики', async () => {
    const root = await open(<NotificationSettingsScreen node={node('n02')} />);
    expect([...root.querySelectorAll('.set-mx.is-head .set-ch')].map((cell) => cell.textContent)).toEqual([
      'Приложение',
      'Почта',
      'Telegram',
    ]);
    expect(root.querySelectorAll('.set-mx:not(.is-head)')).toHaveLength(6);
    const reply = root.querySelector('input[aria-label="Ответы: Приложение"]') as HTMLInputElement;
    expect(reply.checked).toBe(true);
    expect((root.querySelector('input[aria-label="Итоги недели: Приложение"]') as HTMLInputElement).checked).toBe(false);
    expect(root.textContent).not.toMatch(/Приглашения|Как часто|название компании/u);
  });

  it('переключатель сохраняется сразу; сбой возвращает значение и показан на месте', async () => {
    api.updateNotificationPreference.mockResolvedValueOnce({ key: 'ev-reply', app: false, email: true, telegram: false });
    const root = await open(<NotificationSettingsScreen node={node('n02')} />);
    const input = () => root.querySelector('input[aria-label="Ответы: Приложение"]') as HTMLInputElement;
    click(input());
    await settle();
    expect(api.updateNotificationPreference).toHaveBeenCalledWith('ev-reply', { app: false, email: true, telegram: false });
    expect(input().checked).toBe(false);
    api.updateNotificationPreference.mockRejectedValueOnce(new Error('сеть'));
    click(input());
    await settle();
    expect(input().checked).toBe(false);
    expect(root.querySelector('.set-res.is-err span')?.textContent).toBe('Настройка не сохранилась');
  });

  it('Telegram: переключатель ведёт к подключению, ждём подтверждения, затем «Отвязать»', async () => {
    api.startTelegramLink.mockResolvedValue({
      startUrl: 'https://t.me/openqareer_bot?start=code',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const root = await open(<NotificationSettingsScreen node={node('n02')} />);
    const gate = root.querySelector('a.sw-gate[aria-label="Ответы: Telegram — подключить Telegram"]');
    expect(gate?.getAttribute('aria-checked')).toBe('false');
    click(gate);
    await settle();
    const waiting = root.querySelector('p.set-res[role=status]') as HTMLElement;
    expect(waiting.querySelector('span')?.textContent).toBe('Ждём подтверждения в Telegram');
    expect(waiting.querySelector('a.btn')?.getAttribute('href')).toBe('https://t.me/openqareer_bot?start=code');
    expect(waiting.querySelector('a.btn')?.getAttribute('rel')).toContain('noopener');
  });

  it('две строки подряд сохраняются независимо: ответ первой не затирает вторую', async () => {
    const finish: Array<(value: unknown) => void> = [];
    api.updateNotificationPreference.mockImplementation(
      () => new Promise((resolve) => finish.push(resolve)),
    );
    const root = await open(<NotificationSettingsScreen node={node('n02')} />);
    const reply = () => root.querySelector('input[aria-label="Ответы: Приложение"]') as HTMLInputElement;
    const digest = () => root.querySelector('input[aria-label="Итоги недели: Приложение"]') as HTMLInputElement;
    click(reply());
    click(digest());
    expect(reply().disabled && digest().disabled).toBe(true);
    await act(async () => finish[0]({ key: 'ev-reply', app: false, email: true, telegram: false }));
    await settle();
    expect(reply().checked).toBe(false);
    expect(digest().checked).toBe(true);
    await act(async () => finish[1]({ key: 'ev-weekly-digest', app: true, email: true, telegram: false }));
    await settle();
    expect(digest().checked).toBe(true);
    expect(digest().disabled).toBe(false);
  });

  it('ссылка на бота принимается только по https', async () => {
    api.startTelegramLink.mockResolvedValue({
      startUrl: 'javascript:alert(1)',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const root = await open(<NotificationSettingsScreen node={node('n02')} />);
    click(root.querySelector('a.sw-gate'));
    await settle();
    expect(root.querySelector('a[href^="javascript"]')).toBeNull();
    expect(root.querySelector('p.set-res.is-err span')?.textContent).toBe('Ссылка устарела');
  });

  it('Telegram подключён: переключатели в колонке и «Отвязать»', async () => {
    api.getNotificationChannelStatus.mockResolvedValue(channels(true));
    api.disconnectTelegram.mockResolvedValue({ connected: false, disconnected: true });
    const root = await open(<NotificationSettingsScreen node={node('n02')} />);
    expect(root.querySelector('a.sw-gate')).toBeNull();
    expect(root.querySelector('input[aria-label="Ответы: Telegram"]')).not.toBeNull();
    const line = root.querySelector('p.set-res[role=status]') as HTMLElement;
    expect(line.querySelector('span')?.textContent).toBe('Telegram подключён');
    api.getNotificationChannelStatus.mockResolvedValue(channels(false));
    click(line.querySelector('.btn'));
    await settle();
    expect(api.disconnectTelegram).toHaveBeenCalled();
    expect(root.querySelector('a.sw-gate')).not.toBeNull();
  });

  it('B690: подключённый Telegram показан с именем, устаревшая ссылка видна после перезагрузки', async () => {
    api.getNotificationChannelStatus.mockResolvedValue(channels(true));
    api.getTelegramLinkState.mockResolvedValue({ state: 'connected', expiresAt: null, username: '@msokolova_dev' });
    const root = await open(<NotificationSettingsScreen node={node('n02')} />);
    expect(root.querySelector('p.set-res[role=status] span')?.textContent).toBe('Telegram · @msokolova_dev');
    view?.unmount();
    api.getNotificationChannelStatus.mockResolvedValue(channels(false));
    api.getTelegramLinkState.mockResolvedValue({ state: 'expired', expiresAt: null, username: null });
    const again = await open(<NotificationSettingsScreen node={node('n02')} />);
    expect(again.querySelector('p.set-res.is-err span')?.textContent).toBe('Ссылка устарела');
    expect(again.textContent).toContain('Получить новую');
  });

  it('B690: подтверждение в боте приходит с сервера вместе с именем', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      api.startTelegramLink.mockResolvedValue({
        startUrl: 'https://t.me/openqareer_bot?start=code',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
      const root = await open(<NotificationSettingsScreen node={node('n02')} />);
      click(root.querySelector('a.sw-gate'));
      await settle();
      api.getTelegramLinkState.mockResolvedValue({ state: 'connected', expiresAt: null, username: '@msokolova_dev' });
      api.getNotificationChannelStatus.mockResolvedValue(channels(true));
      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
      await settle();
      expect(root.querySelector('p.set-res[role=status] span')?.textContent).toBe('Telegram · @msokolova_dev');
    } finally {
      vi.useRealTimers();
    }
  });

  it('канала Telegram нет — колонки и строки о нём нет', async () => {
    api.getNotificationChannelStatus.mockResolvedValue(channels(false, false));
    const root = await open(<NotificationSettingsScreen node={node('n02')} />);
    expect([...root.querySelectorAll('.set-ch')].map((cell) => cell.textContent)).toEqual(['Приложение', 'Почта']);
    expect(root.textContent).not.toContain('Telegram');
  });
});

describe('n04 «Вход и безопасность»', () => {
  it('разделы по макету; двухфакторной защиты и входа по отпечатку нет', async () => {
    const root = await open(<SecurityScreen node={node('n04')} />);
    expect([...root.querySelectorAll('.set-h')].map((item) => item.textContent)).toEqual([
      'Почта и имя',
      'Вход',
      'Устройства · 2',
    ]);
    expect(root.textContent).not.toMatch(/Двухфакторная|Touch ID|Face ID/u);
    const values = [...root.querySelectorAll('.set-row .set-v')].map((item) => item.textContent);
    expect(values).toEqual([
      'm.sokolova@mail.test · подтверждена',
      'Марина Соколова',
      'сейчас · эта сессия',
      '3 ноября',
    ]);
  });

  it('смена пароля на месте: пароли сверяются, ошибка сервера остаётся у поля, введённое не теряется', async () => {
    const root = await open(<SecurityScreen node={node('n04')} />);
    click([...root.querySelectorAll('button.btn.is-sm')].find((b) => b.textContent === 'Сменить пароль')!);
    const inputs = () => [...root.querySelectorAll('form.c5-form input[type=password]')] as HTMLInputElement[];
    expect(inputs().map((input) => input.autocomplete)).toEqual(['current-password', 'new-password', 'new-password']);
    const submit = () => root.querySelector('form.c5-form .btn.is-primary') as HTMLButtonElement;
    type(inputs()[0], 'old-secret');
    type(inputs()[1], 'new-secret-1');
    type(inputs()[2], 'new-secret-2');
    expect(root.querySelector('form.c5-form .set-res.is-err')?.textContent).toBe('Пароли не совпадают');
    expect(submit().disabled).toBe(true);
    type(inputs()[2], 'new-secret-1');
    api.changePassword.mockRejectedValueOnce(
      new CoachApiError('Проверьте поля', 'validation_failed', false, { currentPassword: 'Пароль не подошёл' }),
    );
    click(submit());
    await settle();
    expect(root.querySelector('form.c5-form .set-res.is-err')?.textContent).toBe('Пароль не подошёл');
    expect(inputs()[1].value).toBe('new-secret-1');
    api.changePassword.mockResolvedValueOnce(session);
    click(submit());
    await settle();
    expect(api.changePassword).toHaveBeenLastCalledWith({ currentPassword: 'old-secret', newPassword: 'new-secret-1' });
    expect(root.querySelector('form.c5-form')).toBeNull();
    expect(root.querySelector('.res-row')?.textContent).toBe('Пароль изменён');
  });

  it('имя правится на месте строки', async () => {
    api.updateAccountProfile.mockResolvedValue({ ...account, displayName: 'Марина С.' });
    const root = await open(<SecurityScreen node={node('n04')} />);
    click(root.querySelectorAll('.set-group')[0].querySelectorAll('button.btn.is-sm')[1]);
    type(root.querySelector('form.c5-form input'), 'Марина С.');
    click(root.querySelector('form.c5-form .btn.is-primary'));
    await settle();
    expect(api.updateAccountProfile).toHaveBeenCalledWith({ displayName: 'Марина С.' });
    expect(root.querySelector('form.c5-form')).toBeNull();
    expect(root.querySelectorAll('.set-row .set-v')[1].textContent).toBe('Марина С.');
  });

  it('новая почта ждёт кода: форма кода открыта сразу', async () => {
    api.getPendingAccountEmailChange.mockResolvedValue({ email: 'new@mail.test', expiresAt: '2026-11-18', resendAfterSeconds: 0 });
    const root = await open(<SecurityScreen node={node('n04')} />);
    expect(root.querySelector('.set-row .set-v')?.textContent).toBe('m.sokolova@mail.test · ждёт кода: new@mail.test');
    expect(root.querySelector('form.c5-form label')?.textContent).toBe('Код из письма на new@mail.test');
  });

  it('сеанс завершается, «Выйти на других устройствах» и выход из аккаунта', async () => {
    api.revokeAccountSession.mockResolvedValue(undefined);
    api.revokeOtherSessions.mockResolvedValue(1);
    const root = await open(<SecurityScreen node={node('n04')} />);
    const end = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Завершить')!;
    expect(end.getAttribute('aria-label')).toBe('Завершить сеанс: другое устройство, 3 ноября');
    click(end);
    await settle();
    expect(api.revokeAccountSession).toHaveBeenCalledWith('bbbbbbbbbbbbbbbb');
    click([...root.querySelectorAll('button')].find((b) => b.textContent === 'Выйти на других устройствах')!);
    await settle();
    expect(api.revokeOtherSessions).toHaveBeenCalled();
    click(root.querySelector('button.set-rowbtn'));
    await settle();
    expect(signOut).toHaveBeenCalled();
  });
});
