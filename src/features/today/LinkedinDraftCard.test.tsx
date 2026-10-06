// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinDraftCard } from './LinkedinDraftCard';
import * as api from './linkedinDraftApi';
import * as safetyApi from './linkedinActionSafetyApi';

const draft = { id: 'one', kind: 'comment' as const, topic: 'Тема', text: 'Мой опыт.', status: 'draft' as const };
describe('LinkedinDraftCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    vi.spyOn(api, 'listDrafts').mockResolvedValue([]);
    vi.spyOn(api, 'createDraft').mockResolvedValue(draft);
    vi.spyOn(api, 'updateDraft').mockImplementation(async (_id, status) => ({ ...draft, status }));
    vi.spyOn(safetyApi, 'getLinkedinActionSafetyStatus').mockResolvedValue({ paused: false, reason: null, canResume: false, updatedAt: null });
    vi.spyOn(safetyApi, 'resumeLinkedinActions').mockResolvedValue({ paused: false, reason: null, canResume: false, updatedAt: null });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  async function render() { await act(async () => root.render(<LinkedinDraftCard onOpenTariffs={vi.fn()} />)); }
  async function prepare() {
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Тема');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }
  const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
  it('does not crash the cabinet when the drafts list comes back in an unexpected shape', async () => {
    vi.mocked(api.listDrafts).mockResolvedValue(null as unknown as api.LinkedinDraft[]);
    await render();
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.querySelector('.career-drafts-recent')).toBeNull();
  });
  it('shows empty form and outlined prepare action', async () => {
    await render(); expect(host.textContent).toContain('Готовим текст — публикуете вы сами');
    expect(button('Подготовить черновик').className).not.toContain('primary');
  });
  it('prepares, copies and persists copied status', async () => {
    await render(); await prepare(); expect(host.textContent).toContain('Мой опыт.');
    await act(async () => button('Скопировать').click());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Мой опыт.');
    expect(api.updateDraft).toHaveBeenCalledWith('one', 'copied'); expect(host.textContent).toContain('скопирован');
  });
  it('does not show copied success when clipboard fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    await render(); await prepare(); await act(async () => button('Скопировать').click());
    expect(api.updateDraft).not.toHaveBeenCalled(); expect(button('Скопировано')).toBeUndefined();
    expect(host.textContent).toContain('Не получилось скопировать');
  });
  it('does not show copied success when status persistence fails', async () => {
    vi.mocked(api.updateDraft).mockRejectedValue(new Error('offline'));
    await render(); await prepare(); await act(async () => button('Скопировать').click());
    expect(button('Скопировано')).toBeUndefined(); expect(host.textContent).toContain('Не получилось скопировать');
  });
  it('rejects and removes current draft', async () => {
    await render(); await prepare(); await act(async () => button('Отклонить').click());
    expect(api.updateDraft).toHaveBeenCalledWith('one', 'rejected'); expect(button('Скопировать')).toBeUndefined();
    expect(host.textContent).toContain('отклонён');
  });
  it.each([429, 503])('shows server message for status %s', async status => {
    vi.mocked(api.createDraft).mockRejectedValue(new api.DraftApiError(status, 'Сообщение сервера'));
    await render(); await prepare(); expect(host.textContent).toContain('Сообщение сервера');
  });
  it('opens paywall for free tier response', async () => {
    vi.mocked(api.createDraft).mockRejectedValue(new api.DraftApiError(402, 'Тариф'));
    await render(); await prepare(); expect(host.querySelector('[role=dialog]')).not.toBeNull();
  });
  it('shows loading until generation completes', async () => {
    vi.mocked(api.createDraft).mockReturnValue(new Promise(() => undefined));
    await render(); await prepare(); expect(button('Готовлю…').disabled).toBe(true);
  });
  it('shows generic error without internal details', async () => {
    vi.mocked(api.createDraft).mockRejectedValue(new Error('private detail'));
    await render(); await prepare(); expect(host.textContent).toContain('Не получилось подготовить черновик. Попробуйте ещё раз');
    expect(host.textContent).not.toContain('private detail');
  });
  it('shows a platform stop reason and clears it only after the candidate resumes manually', async () => {
    vi.mocked(safetyApi.getLinkedinActionSafetyStatus).mockResolvedValue({
      paused: true,
      reason: 'platform_restricted',
      canResume: true,
      updatedAt: null,
    });
    vi.mocked(safetyApi.resumeLinkedinActions).mockResolvedValue({ paused: false, reason: null, canResume: false, updatedAt: null });

    await render();
    expect(host.textContent).toContain('Действия LinkedIn приостановлены');
    expect(host.textContent).toContain('LinkedIn ограничил запрос');

    await act(async () => button('Возобновить вручную').click());
    expect(safetyApi.resumeLinkedinActions).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain('Действия LinkedIn приостановлены');
    expect(host.textContent).toContain('Пауза снята. Следующий запуск потребует вашего подтверждения.');
  });
  it('keeps the stop visible when manual resume fails', async () => {
    vi.mocked(safetyApi.getLinkedinActionSafetyStatus).mockResolvedValue({
      paused: true,
      reason: 'challenge_required',
      canResume: true,
      updatedAt: null,
    });
    vi.mocked(safetyApi.resumeLinkedinActions).mockRejectedValue(new Error('private detail'));

    await render();
    await act(async () => button('Возобновить вручную').click());

    expect(host.textContent).toContain('Действия LinkedIn приостановлены');
    expect(host.textContent).toContain('Не получилось снять паузу');
    expect(host.textContent).not.toContain('private detail');
  });
  it('does not hide an unavailable safety status behind an empty state', async () => {
    vi.mocked(safetyApi.getLinkedinActionSafetyStatus).mockRejectedValue(new Error('private detail'));

    await render();

    expect(host.textContent).toContain('Не удалось проверить статус действий LinkedIn.');
    expect(host.textContent).not.toContain('private detail');
  });
  it('shows that the safety status is still being checked', async () => {
    vi.mocked(safetyApi.getLinkedinActionSafetyStatus).mockReturnValue(new Promise(() => undefined));

    await render();

    expect(host.textContent).toContain('Проверяем статус действий LinkedIn');
    expect(host.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
  });
});
