// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount } from '../kit/testDom';
import { MessageDraft } from './MessageDraft';

vi.mock('./contactMessageApi', () => ({
  createB640ContactMessage: vi.fn(),
  createB640ContactMessageVariant: vi.fn(),
  discardB640ContactMessage: vi.fn(async () => undefined),
  editB640ContactMessage: vi.fn(),
  listB640ContactMessageVariants: vi.fn(),
  approveB640ContactMessage: vi.fn(),
  markB640ContactMessageSent: vi.fn(),
}));
// jsdom без matchMedia: широкий экран (useIsMobile читает медиа-запрос).
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia;
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
  vi.mocked(api.listB640ContactMessageVariants).mockResolvedValue({ variants: [], remaining: 3 });
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

  it('B682: «Что поменять» даёт вариант, варианты листаются, одобряется выбранный', async () => {
    vi.mocked(api.createB640ContactMessage).mockResolvedValue(message('m1', 'Первый'));
    const variant = {
      id: 'v1',
      position: 1,
      text: 'Второй',
      wish: { chips: ['shorter' as const], text: '' },
      createdAt: 'x',
      payload: null,
    };
    vi.mocked(api.createB640ContactMessageVariant).mockResolvedValue({
      variant,
      variants: [variant],
      remaining: 2,
    });
    vi.mocked(api.editB640ContactMessage).mockResolvedValue(message('m1', 'Второй'));
    vi.mocked(api.approveB640ContactMessage).mockResolvedValue({
      ...message('m1', 'Второй'),
      state: 'approved',
      approvedAt: 'x',
      openUrl: null,
    });
    const view = panel();
    await flush();
    const area = () => view.container.querySelector<HTMLTextAreaElement>('.lk-draft')!;
    expect(button(view.container, 'Другой вариант')!.textContent).toContain('3');
    click(button(view.container, 'Другой вариант'));
    click(button(view.container, 'Короче'));
    click(button(view.container, 'Сделать вариант'));
    await flush();
    expect(api.createB640ContactMessageVariant).toHaveBeenCalledWith(
      'm1',
      { chips: ['shorter'], text: '' },
      undefined,
    );
    expect(api.createB640ContactMessage).toHaveBeenCalledTimes(1);
    expect(area().value).toBe('Второй');
    expect(view.container.querySelector('.var-sw .num')!.textContent).toBe('2 из 2');
    expect(button(view.container, 'Другой вариант')!.textContent).toContain('2');
    click(view.container.querySelector<HTMLElement>('[aria-label="Предыдущий вариант"]'));
    expect(area().value).toBe('Первый');
    click(view.container.querySelector<HTMLElement>('[aria-label="Следующий вариант"]'));
    click(button(view.container, 'Одобрить и отправить'));
    await flush();
    expect(api.editB640ContactMessage).toHaveBeenCalledWith('m1', 'Второй');
    expect(api.approveB640ContactMessage).toHaveBeenCalledWith('m1');
  });

  it('B682: открытый снова черновик приходит со своими вариантами и остатком', async () => {
    vi.mocked(api.createB640ContactMessage).mockResolvedValue(message('m1', 'Первый'));
    const variants = ['Второй', 'Третий'].map((text, index) => ({
      id: `v${index}`,
      position: index + 1,
      text,
      wish: { chips: [], text: '' },
      createdAt: 'x',
      payload: null,
    }));
    vi.mocked(api.listB640ContactMessageVariants).mockResolvedValue({ variants, remaining: 1 });
    const view = panel();
    await flush();
    await flush();
    expect(view.container.querySelector('.var-sw .num')!.textContent).toBe('1 из 3');
    expect(button(view.container, 'Другой вариант')!.textContent).toContain('1');
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
    vi.mocked(api.discardB640ContactMessage).mockRejectedValueOnce(new Error('boom'));
    click(button(view.container, 'Не отправлять'));
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Черновик не убран.');
    click(button(view.container, 'Повторить'));
    await flush();
    expect(api.discardB640ContactMessage).toHaveBeenLastCalledWith('m1');
    expect(onClose).toHaveBeenCalled();
  });

  it('B753: «Не отправлять» до прихода черновика — пришедший черновик убирается', async () => {
    let arrive = (_value: ReturnType<typeof message>) => undefined as void;
    vi.mocked(api.createB640ContactMessage).mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    const view = panel();
    click(button(view.container, 'Не отправлять'));
    expect(onClose).toHaveBeenCalled();
    arrive(message('m9', 'Текст'));
    await flush();
    expect(api.discardB640ContactMessage).toHaveBeenCalledWith('m9');
  });
});
