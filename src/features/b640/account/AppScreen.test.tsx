// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { AppScreen } from './AppScreen';

vi.mock('../../../services/desktop/desktopBridge', async (original) => ({
  ...(await original<typeof import('../../../services/desktop/desktopBridge')>()),
  isTauriEnvironment: () => true,
}));
vi.mock('../../appUpdate/useDesktopUpdater', () => ({
  desktopUpdater: { check: vi.fn(async () => undefined), getStatus: () => ({ state: 'idle' }) },
}));
vi.mock('../../coach/coachApi', async (original) => ({
  ...(await original<typeof import('../../coach/coachApi')>()),
  getAccount: vi.fn(async () => ({ timezone: 'Europe/Moscow' })),
  updateAccountProfile: vi.fn(async () => ({})),
}));

const session = { username: 'f.test', role: 'candidate', isTest: true, candidateId: 'c', features: { cabinetB640: true }, emailVerified: true } as AuthUser;
let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('n06 «Приложение» в .app', () => {
  it('строка версии показывает версию, номер сборки и дату сборки', async () => {
    const value = { session, path: '/app/account/app', search: '', match: null, consultantRoute: null, navigate: vi.fn(), signOut: async () => undefined, theme: 'light' as const, setTheme: () => undefined };
    view = mount(<ShellProvider value={value}><AppScreen node={nodeByCode('n06')!} /></ShellProvider>);
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    const line = [...view.container.querySelectorAll('.set-t')].map((item) => item.textContent ?? '').find((text) => text.startsWith('Версия'));
    expect(line).toMatch(new RegExp(`^Версия ${__APP_VERSION__.replace(/\./gu, '\\.')}( · сборка [0-9a-f]{7})? · \\d{1,2} [а-я]+ \\d{4}$`, 'u'));
    expect(view.container.textContent).toContain('Проверить обновления');
  });
});
