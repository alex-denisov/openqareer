// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { B640HhRaiseState } from '../../../../../shared/b640HhRaise';
import { click, mount, type Mounted } from '../../kit/testDom';

const api = vi.hoisted(() => ({ getHhRaise: vi.fn(), setHhRaiseEnabled: vi.fn(), retryHhRaise: vi.fn() }));
const desktop = vi.hoisted(() => ({ openHhSignIn: vi.fn() }));
const poller = vi.hoisted(() => ({ requestHhRaiseStep: vi.fn() }));
vi.mock('./hhRaiseApi', () => api);
vi.mock('../../apply/hh/hhRaisePoller', () => poller);
vi.mock('../../apply/hh/hhDesktop', () => desktop);

const { HH_RAISE_REFRESH_MS, HhRaiseStatus } = await import('./HhRaiseStatus');

const base: B640HhRaiseState = {
  connected: true, resumeId: 'abc', resumes: [{ id: 'abc', title: 'Инженер', updatedLabel: 'обновлено 3 ноября' }], enabled: true, everyHours: 4,
  lastRaisedAt: null, nextRaiseAt: null, lastResult: null, pausedUntil: null, pauseReason: null, pending: false,
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

beforeEach(() => vi.resetAllMocks());
afterEach(() => { view?.unmount(); view = null; vi.useRealTimers(); });

describe('B699: состояние автоподнятия', () => {
  it('тихая строка: когда поднято и когда следующее', async () => {
    // Следующий подъём впереди: прошедшее время строка не показывает (B699, прод 22.11).
    const last = new Date(Date.now() - 3_600_000).toISOString();
    const next = new Date(Date.now() + 3 * 3_600_000).toISOString();
    await show({ lastRaisedAt: last, nextRaiseAt: next, lastResult: { status: 'ok', reason: null, at: '' } });
    expect(text()).toContain(`Резюме поднято · ${time(last)}, следующее ≈ ${time(next)}`);
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

  it('«Повторить» и включение сразу запускают шаг опроса, выключение и отказ — нет', async () => {
    api.retryHhRaise.mockRejectedValueOnce(new Error('x'));
    await show({ lastResult: { status: 'error', reason: 'x', at: '' } });
    click(button('Повторить'));
    await flush();
    expect(poller.requestHhRaiseStep).not.toHaveBeenCalled();
    api.retryHhRaise.mockResolvedValueOnce({ ...base, pending: true });
    click(button('Повторить'));
    await flush();
    expect(poller.requestHhRaiseStep).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Резюме будет поднято');
    expect(button('Повторить')).toBeNull();

    const toggle = () => click(view!.container.querySelector('[role="switch"]'));
    api.setHhRaiseEnabled.mockResolvedValueOnce({ ...base, enabled: false });
    toggle();
    await flush();
    expect(poller.requestHhRaiseStep).toHaveBeenCalledTimes(1);
    api.setHhRaiseEnabled.mockResolvedValueOnce(base);
    toggle();
    await flush();
    expect(poller.requestHhRaiseStep).toHaveBeenCalledTimes(2);
  });

  it('пока задание открыто, состояние перечитывается и останавливается при исходе', async () => {
    vi.useFakeTimers();
    const tick = () => act(() => vi.advanceTimersByTimeAsync(HH_RAISE_REFRESH_MS));
    await show({ pending: true });
    api.getHhRaise.mockRejectedValueOnce(new Error('offline'));
    await tick();
    expect(api.getHhRaise).toHaveBeenCalledTimes(2);
    api.getHhRaise.mockResolvedValue({ ...base, lastRaisedAt: new Date().toISOString() });
    await tick();
    expect(text()).toContain('Резюме поднято');
    await tick();
    expect(api.getHhRaise).toHaveBeenCalledTimes(3);
  });

  it('после размонтирования и без задания состояние не перечитывается', async () => {
    vi.useFakeTimers();
    await show({ pending: true });
    view?.unmount();
    view = null;
    await vi.advanceTimersByTimeAsync(HH_RAISE_REFRESH_MS * 2);
    expect(api.getHhRaise).toHaveBeenCalledTimes(1);
    await show({});
    await act(() => vi.advanceTimersByTimeAsync(HH_RAISE_REFRESH_MS * 2));
    expect(api.getHhRaise).toHaveBeenCalledTimes(2);
  });

  it('a11: поле «Резюме» показывает список и сохраняет выбор', async () => {
    const resumes = [...base.resumes, { id: 'def', title: 'Архитектор' }];
    api.setHhRaiseEnabled.mockResolvedValue({ ...base, resumes, resumeId: 'def' });
    await show({ resumes });
    const select = view!.container.querySelector<HTMLSelectElement>('.pf-f.hh-cv select#hh-cv')!;
    expect(view!.container.querySelector('label[for="hh-cv"]')?.textContent).toBe('Резюме');
    expect([...select.options].map((o) => o.text)).toEqual(['Инженер · обновлено 3 ноября', 'Архитектор']);
    expect(select.value).toBe('abc');
    act(() => {
      select.value = 'def';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(api.setHhRaiseEnabled).toHaveBeenCalledWith(true, 'def');
    expect(select.value).toBe('def');
  });

  it('a11: одно резюме — поле с одним вариантом', async () => {
    await show({});
    expect(view!.container.querySelectorAll('#hh-cv option')).toHaveLength(1);
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
