// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { B640HhRaiseState } from '../../../../../shared/b640HhRaise';
import { click, mount, type Mounted } from '../../kit/testDom';

const api = vi.hoisted(() => ({ getHhRaise: vi.fn(), setHhRaiseEnabled: vi.fn(), retryHhRaise: vi.fn() }));
const desktop = vi.hoisted(() => ({ openHhSignIn: vi.fn() }));
vi.mock('./hhRaiseApi', () => api);
vi.mock('../../apply/hh/hhDesktop', () => desktop);

const { HhRaiseStatus } = await import('./HhRaiseStatus');

const base: B640HhRaiseState = {
  connected: true, resumeId: 'abc', enabled: true, everyHours: 4,
  lastRaisedAt: null, nextRaiseAt: null, lastResult: null, pausedUntil: null, pauseReason: null,
};
const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
let view: Mounted | null = null;
const text = () => view?.container.textContent ?? '';
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const show = async (patch: Partial<B640HhRaiseState>) => {
  view?.unmount();
  api.getHhRaise.mockResolvedValue({ ...base, ...patch });
  view = mount(<HhRaiseStatus />);
  await flush();
};
const button = (label: string) =>
  [...(view?.container.querySelectorAll('button') ?? [])].find((b) => b.textContent === label) ?? null;

beforeEach(() => vi.clearAllMocks());
afterEach(() => { view?.unmount(); view = null; });

describe('B699: состояние автоподнятия', () => {
  it('тихая строка: когда поднято и когда следующее', async () => {
    await show({ lastRaisedAt: '2026-11-19T09:40:00Z', nextRaiseAt: '2026-11-19T13:50:00Z', lastResult: { status: 'ok', reason: null, at: '' } });
    expect(text()).toContain(`Резюме поднято · ${time('2026-11-19T09:40:00Z')}, следующее ≈ ${time('2026-11-19T13:50:00Z')}`);
    expect(button('Повторить')).toBeNull();
  });

  it('ошибка: «Не поднято» и «Повторить» шлёт повтор', async () => {
    api.retryHhRaise.mockResolvedValue({ ...base });
    await show({ lastResult: { status: 'error', reason: 'x', at: '' } });
    expect(text()).toContain('Не поднято');
    click(button('Повторить'));
    await flush();
    expect(api.retryHhRaise).toHaveBeenCalledWith('abc');
    expect(text()).not.toContain('Не поднято');
  });

  it('капча: пауза до времени; выход: «Войдите в hh.ru заново»', async () => {
    await show({ pauseReason: 'captcha', pausedUntil: '2026-11-20T09:40:00Z' });
    expect(text()).toContain(`Пауза до ${time('2026-11-20T09:40:00Z')}: hh.ru попросил капчу`);
    await show({ pauseReason: 'logged_out' });
    expect(text()).toContain('Войдите в hh.ru заново');
    click(button('Войти'));
    expect(desktop.openHhSignIn).toHaveBeenCalled();
  });

  it('переключатель выключает поднятие', async () => {
    api.setHhRaiseEnabled.mockResolvedValue({ ...base, enabled: false });
    await show({});
    click(view!.container.querySelector('[role="switch"]'));
    await flush();
    expect(api.setHhRaiseEnabled).toHaveBeenCalledWith(false, 'abc');
    expect((view!.container.querySelector('[role="switch"]') as HTMLInputElement).checked).toBe(false);
  });

  it('hh не подключён — ничего не показывает; сбой загрузки — строка ошибки', async () => {
    await show({ connected: false });
    expect(view!.container.querySelector('[role="switch"]')).toBeNull();
    view?.unmount();
    api.getHhRaise.mockRejectedValue(new Error('x'));
    view = mount(<HhRaiseStatus />);
    await flush();
    expect(text()).toContain('Состояние поднятия не загрузилось');
  });
});
