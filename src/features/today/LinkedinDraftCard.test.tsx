// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinDraftCard } from './LinkedinDraftCard';
import * as api from './linkedinDraftApi';
import * as safetyApi from './linkedinActionSafetyApi';

const draft = {
  id: 'one',
  kind: 'comment' as const,
  topic: 'Тема',
  text: 'Мой опыт.',
  status: 'draft' as const,
};
const emptyTopics = {
  items: [],
  total: 0,
  cadence: {
    timezone: 'Europe/Moscow',
    lastPublishedAt: null,
    nextAllowedAt: null,
    canPublish: true,
  },
};
const topic = {
  id: 'a'.repeat(64),
  title: 'Сократил выпуск продукта',
  source: 'Подтверждённый факт профиля',
  sourceRef: 'fact-1',
};
describe('LinkedinDraftCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(api, 'listDrafts').mockResolvedValue([]);
    vi.spyOn(api, 'listDraftTopics').mockResolvedValue(emptyTopics);
    vi.spyOn(api, 'dismissDraftTopic').mockResolvedValue({ id: topic.id, decision: 'dismissed' });
    vi.spyOn(api, 'createDraft').mockResolvedValue(draft);
    vi.spyOn(api, 'updateDraft').mockImplementation(async (_id, update) => ({
      ...draft,
      ...('status' in update ? { status: update.status } : { text: update.text }),
    }));
    vi.spyOn(safetyApi, 'getLinkedinActionSafetyStatus').mockResolvedValue({
      paused: false,
      reason: null,
      canResume: false,
      updatedAt: null,
    });
    vi.spyOn(safetyApi, 'resumeLinkedinActions').mockResolvedValue({
      paused: false,
      reason: null,
      canResume: false,
      updatedAt: null,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  async function render(pipeline = false) {
    await act(async () => root.render(<LinkedinDraftCard variant={pipeline ? 'pipeline' : 'compact'} onOpenTariffs={vi.fn()} />));
  }
  async function prepare() {
    const input = host.querySelector('textarea[aria-label="Тема"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Тема');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
  it('does not crash the cabinet when the drafts list comes back in an unexpected shape', async () => {
    vi.mocked(api.listDrafts).mockResolvedValue(null as unknown as api.LinkedinDraft[]);
    await render();
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.querySelector('ul.career-drafts-recent')).toBeNull();
  });
  it('shows empty form and outlined prepare action', async () => {
    await render();
    expect(host.textContent).toContain('Готовим текст — публикуете вы сами');
    expect(button('Подготовить черновик').className).not.toContain('primary');
  });
  it('prepares, copies and persists copied status', async () => {
    await render();
    await prepare();
    expect(host.textContent).toContain('Мой опыт.');
    await act(async () => button('Скопировать').click());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Мой опыт.');
    expect(api.updateDraft).toHaveBeenCalledWith('one', { status: 'copied' });
    expect(host.textContent).toContain('скопирован');
  });
  it('does not show copied success when clipboard fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    await render();
    await prepare();
    await act(async () => button('Скопировать').click());
    expect(api.updateDraft).not.toHaveBeenCalled();
    expect(button('Скопировано')).toBeUndefined();
    expect(host.textContent).toContain('Не получилось скопировать');
  });
  it('does not show copied success when status persistence fails', async () => {
    vi.mocked(api.updateDraft).mockRejectedValue(new Error('offline'));
    await render();
    await prepare();
    await act(async () => button('Скопировать').click());
    expect(button('Скопировано')).toBeUndefined();
    expect(host.textContent).toContain('Не получилось скопировать');
  });
  it('rejects and removes current draft', async () => {
    await render();
    await prepare();
    await act(async () => button('Отклонить').click());
    expect(api.updateDraft).toHaveBeenCalledWith('one', { status: 'rejected' });
    expect(button('Скопировать')).toBeUndefined();
    expect(host.textContent).toContain('отклонён');
  });
  it.each([429, 503])('shows server message for status %s', async (status) => {
    vi.mocked(api.createDraft).mockRejectedValue(new api.DraftApiError(status, 'Сообщение сервера'));
    await render();
    await prepare();
    expect(host.textContent).toContain('Сообщение сервера');
  });
  it('opens paywall for free tier response', async () => {
    vi.mocked(api.createDraft).mockRejectedValue(new api.DraftApiError(402, 'Тариф'));
    await render();
    await prepare();
    expect(host.querySelector('[role=dialog]')).not.toBeNull();
  });
  it('shows loading until generation completes', async () => {
    vi.mocked(api.createDraft).mockReturnValue(new Promise(() => undefined));
    await render();
    await prepare();
    expect(button('Готовлю…').disabled).toBe(true);
  });
  it('shows generic error without internal details', async () => {
    vi.mocked(api.createDraft).mockRejectedValue(new Error('private detail'));
    await render();
    await prepare();
    expect(host.textContent).toContain('Не получилось подготовить черновик. Попробуйте ещё раз');
    expect(host.textContent).not.toContain('private detail');
  });
  it('shows a platform stop reason and clears it only after the candidate resumes manually', async () => {
    vi.mocked(safetyApi.getLinkedinActionSafetyStatus).mockResolvedValue({
      paused: true,
      reason: 'platform_restricted',
      canResume: true,
      updatedAt: null,
    });
    vi.mocked(safetyApi.resumeLinkedinActions).mockResolvedValue({
      paused: false,
      reason: null,
      canResume: false,
      updatedAt: null,
    });

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

  it('starts a real post draft from a consultant topic and preserves its source id', async () => {
    vi.mocked(api.listDraftTopics).mockResolvedValue({ ...emptyTopics, items: [topic], total: 1 });
    await render(true);
    await act(async () => button('Взять в работу').click());
    expect(api.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'post',
        topic: topic.title,
        topicId: topic.id,
      }),
    );
    expect(host.textContent).toContain('Мой опыт.');
  });

  it('sends selected input type, tone, and length with a candidate text', async () => {
    await render(true);
    const input = host.querySelector('textarea[aria-label="Тема"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Готовый текст кандидата.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (const [index, value] of [[0, 'text'], [1, 'expert'], [2, 'short']] as const) {
      const select = host.querySelectorAll('select')[index];
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await act(async () => button('Пост').click());
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'post',
      topic: 'Готовый текст кандидата',
      sourceText: 'Готовый текст кандидата.',
      inputType: 'text',
      tone: 'expert',
      length: 'short',
    }));
  });

  it('dismisses a topic through the candidate API', async () => {
    vi.mocked(api.listDraftTopics).mockResolvedValue({ ...emptyTopics, items: [topic], total: 1 });
    await render(true);
    await act(async () => button('Скрыть тему').click());
    expect(api.dismissDraftTopic).toHaveBeenCalledWith(topic.id);
  });

  it('edits a draft and requires a separate manual publish confirmation after approval', async () => {
    await render(true);
    await prepare();
    await act(async () => button('Править').click());
    const editor = host.querySelector('textarea[aria-label="Текст черновика"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, 'Исправленный текст.');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Сохранить правку').click());
    expect(api.updateDraft).toHaveBeenCalledWith('one', { text: 'Исправленный текст.' });

    await act(async () => button('Одобрить').click());
    expect(api.updateDraft).toHaveBeenCalledWith('one', { status: 'approved' });
    const openLinkedin = vi.spyOn(window, 'open').mockImplementation(() => null);
    await act(async () => button('Скопировать и открыть LinkedIn').click());
    expect(openLinkedin).toHaveBeenCalledWith('https://www.linkedin.com/feed/', '_blank', 'noopener,noreferrer');
    expect(api.updateDraft).not.toHaveBeenCalledWith('one', { status: 'published' });

    await act(async () => button('Отметить опубликованным').click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Вы уже опубликовали');
    await act(async () => button('Да, отметить').click());
    expect(api.updateDraft).toHaveBeenCalledWith('one', { status: 'published' });
  });

  it('shows the seven-day limit from the server and hides the publish action until its date', async () => {
    vi.mocked(api.listDrafts).mockResolvedValue([{ ...draft, status: 'approved' }]);
    vi.mocked(api.listDraftTopics).mockResolvedValue({
      ...emptyTopics,
      cadence: {
        timezone: 'Europe/Moscow',
        lastPublishedAt: '2026-10-09T10:00:00.000Z',
        nextAllowedAt: '2026-10-16T10:00:00.000Z',
        canPublish: false,
      },
    });
    await render(true);
    expect(host.textContent).toContain('Следующая публикация доступна');
    expect(button('Скопировать и открыть LinkedIn')).toBeUndefined();
  });
});
