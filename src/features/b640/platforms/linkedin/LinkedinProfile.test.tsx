// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount } from '../../kit/testDom';
import { nodeByCode } from '../../routes';
import Section from '../index';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));
vi.mock('../../../coach/coachApi', () => ({ getConnections: vi.fn() }));
vi.mock('./linkedinProfileApi', () => ({
  getLinkedinProfile: vi.fn(),
  saveSectionCurrent: vi.fn(),
  markSectionCopied: vi.fn(),
  markSectionPasted: vi.fn(),
}));

const coach = await import('../../../coach/coachApi');
const api = await import('./linkedinProfileApi');

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const node = () => {
  const found = nodeByCode('a03');
  if (!found) throw new Error('a03');
  return found;
};
const empty = { current: null, suggestion: null, copiedAt: null, pastedAt: null };
const profile = (patch: Record<string, unknown> = {}) => ({
  headline: {
    current: { text: 'Руковожу группой', source: 'paste', capturedAt: '2026-11-19T10:00:00Z' },
    suggestion: {
      text: 'Engineering Manager · платёжная платформа',
      facts: [
        { id: 'f1', text: 'Группа из 9 человек' },
        { id: 'f2', text: 'Релиз раз в 3 дня' },
      ],
    },
    copiedAt: null,
    pastedAt: null,
  },
  about: empty,
  experience: empty,
  skills: empty,
  ...patch,
});
const connected = [{ platform: 'linkedin', status: 'imported' }];

async function open(view = profile()) {
  vi.mocked(coach.getConnections).mockResolvedValue(connected as never);
  vi.mocked(api.getLinkedinProfile).mockResolvedValue(view as never);
  const mounted = mount(<Section node={node()} params={{}} />);
  await flush();
  return mounted;
}
const button = (root: HTMLElement, label: string) =>
  root.querySelector<HTMLElement>(`[aria-label="${label}"]`) ??
  [...root.querySelectorAll('button')].find((item) => item.textContent?.includes(label)) ??
  null;
function type(area: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => vi.clearAllMocks());

describe('a03: разделы профиля LinkedIn', () => {
  it('«Сейчас» с источником и датой, предложение с фактами, без «Применить»', async () => {
    const view = await open();
    const root = view.container;
    expect(root.querySelectorAll('.li-sec')).toHaveLength(4);
    expect(root.querySelector('.li-cur')!.textContent).toBe('Руковожу группой');
    expect(root.textContent).toContain('вставлено вами 19 ноября');
    expect(root.querySelector('.li-new')!.textContent).toContain('Engineering Manager');
    expect(root.querySelectorAll('.li-facts li')).toHaveLength(2);
    expect(root.textContent).not.toMatch(/Применить|Другой вариант/);
    view.unmount();
  });
  it('без «сейчас»: поле вставки, «Сохранить» кладёт текст на место', async () => {
    const view = await open(profile({ about: { ...empty } }));
    const root = view.container;
    const areas = root.querySelectorAll('textarea');
    expect(areas).toHaveLength(3);
    const saved = { text: 'Строю команды', source: 'paste', capturedAt: '2026-11-19T11:00:00Z' };
    vi.mocked(api.saveSectionCurrent).mockResolvedValue(saved as never);
    type(areas[0], 'Строю команды');
    await act(async () => click(button(root, 'Сохранить: О себе')));
    expect(api.saveSectionCurrent).toHaveBeenCalledWith('about', 'Строю команды');
    expect(root.querySelectorAll('textarea')).toHaveLength(2);
    expect(root.textContent).toContain('Строю команды');
    view.unmount();
  });
  it('ошибка сохранения — под полем, текст остаётся', async () => {
    const view = await open(profile({ about: { ...empty } }));
    const root = view.container;
    vi.mocked(api.saveSectionCurrent).mockRejectedValue(new Error('Вставьте текст раздела'));
    type(root.querySelector('textarea')!, 'abc');
    await act(async () => click(button(root, 'Сохранить: О себе')));
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Вставьте текст раздела');
    expect(root.querySelector('textarea')!.value).toBe('abc');
    view.unmount();
  });
  it('«Скопировать» копирует и отмечает', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.mocked(api.markSectionCopied).mockResolvedValue({
      copiedAt: '2026-11-19T12:00:00Z',
      pastedAt: null,
    } as never);
    const view = await open();
    await act(async () => click(button(view.container, 'Скопировать: Заголовок')));
    expect(writeText).toHaveBeenCalledWith('Engineering Manager · платёжная платформа');
    expect(api.markSectionCopied).toHaveBeenCalledWith('headline');
    view.unmount();
  });
  it('«Открыть в LinkedIn» — ссылка в новой вкладке', async () => {
    const view = await open();
    const link = view.container.querySelector<HTMLAnchorElement>('a[aria-label="Открыть в LinkedIn: Заголовок"]')!;
    expect(link.getAttribute('href')).toBe('https://www.linkedin.com/in/me/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    view.unmount();
  });
  it('«Вставлено» ставит метку на месте кнопки', async () => {
    vi.mocked(api.markSectionPasted).mockResolvedValue({
      copiedAt: null,
      pastedAt: '2026-11-19T12:30:00Z',
    } as never);
    const view = await open();
    await act(async () => click(button(view.container, 'Вставлено: Заголовок')));
    expect(api.markSectionPasted).toHaveBeenCalledWith('headline');
    expect(button(view.container, 'Вставлено: Заголовок')).toBeNull();
    expect(view.container.textContent).toContain('Вставлено 19 ноября');
    view.unmount();
  });
  it('ошибка метки — на месте, с «Повторить»', async () => {
    vi.mocked(api.markSectionPasted).mockRejectedValue(new Error('x'));
    const view = await open();
    await act(async () => click(button(view.container, 'Вставлено: Заголовок')));
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Повторить');
    view.unmount();
  });
  it('раздел без предложения показывает только «Сейчас»', async () => {
    const view = await open(profile({ headline: { ...profile().headline, suggestion: null } }));
    expect(view.container.querySelector('.li-offer')).toBeNull();
    expect(view.container.querySelector('.li-cur')).not.toBeNull();
    view.unmount();
  });
  it('ошибка чтения — «Повторить»', async () => {
    vi.mocked(coach.getConnections).mockResolvedValue(connected as never);
    vi.mocked(api.getLinkedinProfile).mockRejectedValue(new Error('x'));
    const view = mount(<Section node={node()} params={{}} />);
    await flush();
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Повторить');
    view.unmount();
  });
});
