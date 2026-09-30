// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinDraftCard } from './LinkedinDraftCard';
import * as api from './linkedinDraftApi';

const draft = { id: 'one', kind: 'comment' as const, topic: 'Тема', text: 'Мой опыт.', status: 'draft' as const };
describe('LinkedinDraftCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    vi.spyOn(api, 'listDrafts').mockResolvedValue([]);
    vi.spyOn(api, 'createDraft').mockResolvedValue(draft);
    vi.spyOn(api, 'updateDraft').mockImplementation(async (_id, status) => ({ ...draft, status }));
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
});
