// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount } from '../kit/testDom';
import { MessageDraft } from './MessageDraft';

vi.mock('./contactMessageApi', () => ({
  createB640ContactMessage: vi.fn(),
  editB640ContactMessage: vi.fn(),
  approveB640ContactMessage: vi.fn(),
  markB640ContactMessageSent: vi.fn(),
}));
const api = await import('./contactMessageApi');

const URL_ROMAN = 'https://www.linkedin.com/in/roman-efimov';
const message = (id: string, text: string) => ({
  id,
  kind: 'known_contact' as const,
  text,
  recipient: { name: 'Роман Ефимов', linkedinUrl: URL_ROMAN },
  createdAt: '2026-11-12T12:03:00.000Z',
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((node) =>
    node.textContent?.includes(text),
  ) ?? null;
const typeInto = (area: HTMLTextAreaElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });

const onSent = vi.fn();
const onClose = vi.fn();
const panel = () =>
  mount(
    <MessageDraft
      target={{ contactId: 'c8' }}
      kind="known_contact"
      recipientName="Роман Ефимов"
      onSent={onSent}
      onClose={onClose}
    />,
  );

const opened: string[] = [];
const copied: string[] = [];
beforeEach(() => {
  opened.length = 0;
  copied.length = 0;
  vi.spyOn(window, 'open').mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('MessageDraft', () => {
  it('черновик → правка → «Одобрить и отправить» → «Отправил» → onSent', async () => {
    vi.mocked(api.createB640ContactMessage).mockResolvedValue(message('m1', 'Роман, добрый день!'));
    vi.mocked(api.editB640ContactMessage).mockResolvedValue(message('m1', 'Роман, привет'));
    vi.mocked(api.approveB640ContactMessage).mockResolvedValue({
      ...message('m1', 'Роман, привет'),
      state: 'approved',
      approvedAt: 'x',
      openUrl: URL_ROMAN,
    });
    vi.mocked(api.markB640ContactMessageSent).mockResolvedValue({
      ...message('m1', 'Роман, привет'),
      state: 'sent',
      sentAt: '2026-11-12T12:05:00.000Z',
    });
    const view = panel();
    await flush();
    expect(api.createB640ContactMessage).toHaveBeenCalledWith({ contactId: 'c8' }, 'known_contact');
    const area = view.container.querySelector('textarea')!;
    expect(area.value).toBe('Роман, добрый день!');
    typeInto(area, 'Роман, привет');
    click(button(view.container, 'Одобрить и отправить'));
    await flush();
    expect(api.editB640ContactMessage).toHaveBeenCalledWith('m1', 'Роман, привет');
    expect(opened).toEqual([URL_ROMAN]);
    expect(copied).toEqual(['Роман, привет']);
    expect(view.container.textContent).toContain('Текст скопирован — отправьте в LinkedIn');
    expect(onSent).not.toHaveBeenCalled();
    click(button(view.container, 'Отправил'));
    await flush();
    expect(onSent).toHaveBeenCalledWith('2026-11-12T12:05:00.000Z');
  });

  it('«Другой вариант» просит новый текст, счётчик уменьшается до нуля', async () => {
    const create = vi.mocked(api.createB640ContactMessage);
    create.mockResolvedValueOnce(message('m1', 'Первый'));
    create.mockResolvedValueOnce(message('m2', 'Второй'));
    const view = panel();
    await flush();
    expect(button(view.container, 'Другой вариант')!.textContent).toContain('3');
    click(button(view.container, 'Другой вариант'));
    await flush();
    expect(view.container.querySelector('textarea')!.value).toBe('Второй');
    expect(button(view.container, 'Другой вариант')!.textContent).toContain('2');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('ошибка на месте и «Повторить»; «Не отправлять» закрывает панель', async () => {
    vi.mocked(api.createB640ContactMessage)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(message('m1', 'Текст'));
    const view = panel();
    await flush();
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    click(button(view.container, 'Повторить'));
    await flush();
    expect(view.container.querySelector('textarea')!.value).toBe('Текст');
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    click(button(view.container, 'Не отправлять'));
    expect(onClose).toHaveBeenCalled();
  });
});
