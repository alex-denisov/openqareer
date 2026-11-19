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
vi.mock('../../../resume/resumeApi', () => ({ getResumeStudio: vi.fn() }));
vi.mock('../../../today/linkedinDraftApi', async (original) => ({
  ...(await original<typeof import('../../../today/linkedinDraftApi')>()),
  listDrafts: vi.fn(),
  updateDraft: vi.fn(),
  listDraftTopics: vi.fn(),
  createDraft: vi.fn(),
}));

const coach = await import('../../../coach/coachApi');
const resume = await import('../../../resume/resumeApi');
const api = await import('../../../today/linkedinDraftApi');

const flush = () => act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
const node = (code: string) => {
  const found = nodeByCode(code);
  if (!found) throw new Error(code);
  return found;
};
const linkedin = (connected: boolean) =>
  connected
    ? { platform: 'linkedin', available: true, capabilities: [], importsCareerHistory: true, status: 'imported', importedAt: '2026-11-01T10:00:00Z' }
    : { platform: 'linkedin', available: true, capabilities: [], importsCareerHistory: true, status: 'disconnected' };
const studio = {
  projection: { master: { targetRole: 'Руководитель разработки', about: 'Строю команды.', skills: [{ id: '1', name: 'Go' }] } },
};
const draft = (index: number, patch: Record<string, unknown> = {}) => ({
  id: `d${index}`, kind: 'post', topic: `Тема ${index}`, text: `Текст ${index}`, status: 'draft', ...patch,
});
const many = (count: number, kind = 'post', status = 'published') =>
  Array.from({ length: count }, (_, i) => draft(i, { kind, status }));

afterEach(() => vi.clearAllMocks());

describe('a03: профиль LinkedIn', () => {
  it('тексты разделов с «Скопировать», без «Применить»', async () => {
    vi.mocked(coach.getConnections).mockResolvedValue([linkedin(true)] as never);
    vi.mocked(resume.getResumeStudio).mockResolvedValue(studio as never);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const view = mount(<Section node={node('a03')} params={{}} />);
    await flush();
    expect(view.container.querySelectorAll('.li-sec')).toHaveLength(3);
    expect(view.container.textContent).not.toMatch(/Применить|Другой вариант/);
    await act(async () => click(view.container.querySelector('button[aria-label="Скопировать: Заголовок"]')!));
    expect(writeText).toHaveBeenCalledWith('Руководитель разработки · Go');
    view.unmount();
  });
  it('не подключён: строка с «Подключить»', async () => {
    vi.mocked(coach.getConnections).mockResolvedValue([linkedin(false)] as never);
    const view = mount(<Section node={node('a03')} params={{}} />);
    await flush();
    expect(view.container.querySelector('a[aria-label="Подключить LinkedIn"]')).not.toBeNull();
    expect(view.container.querySelector('.li-sec')).toBeNull();
    view.unmount();
  });
  it('ошибка чтения: «Повторить» на месте', async () => {
    vi.mocked(coach.getConnections).mockRejectedValue(new Error('x'));
    const view = mount(<Section node={node('a03')} params={{}} />);
    await flush();
    expect(view.container.querySelector('[role="alert"]')!.textContent).toContain('Повторить');
    view.unmount();
  });
});

describe('a03p, a03b, a05', () => {
  it('публикации: 20 строк и «Показать ещё»', async () => {
    vi.mocked(api.listDrafts).mockResolvedValue(many(27) as never);
    const view = mount(<Section node={node('a03p')} params={{}} />);
    await flush();
    expect(view.container.querySelectorAll('li.li-pub')).toHaveLength(20);
    const more = [...view.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Показать ещё'))!;
    await act(async () => click(more));
    expect(view.container.querySelectorAll('li.li-pub')).toHaveLength(27);
    view.unmount();
  });
  it('посты: текущий черновик с «Скопировать»; без черновика — «Подготовить черновик»', async () => {
    vi.mocked(api.listDrafts).mockResolvedValue([draft(1)] as never);
    const view = mount(<Section node={node('a03b')} params={{}} />);
    await flush();
    expect((view.container.querySelector('#po-text') as HTMLTextAreaElement).value).toBe('Текст 1');
    expect(view.container.textContent).not.toMatch(/Одобрить|поставить в план/);
    view.unmount();
    vi.mocked(api.listDrafts).mockResolvedValue([] as never);
    const empty = mount(<Section node={node('a03b')} params={{}} />);
    await flush();
    expect(empty.container.textContent).toContain('Подготовить черновик');
    empty.unmount();
  });
  it('лента без комментариев: пустое состояние, без действий', async () => {
    vi.mocked(api.listDrafts).mockResolvedValue([draft(1)] as never);
    const view = mount(<Section node={node('a05')} params={{}} />);
    await flush();
    expect(view.container.querySelector('.vl-empty-t')!.textContent).toBe('Новых постов нет');
    expect(view.container.querySelector('.vl-empty button')).toBeNull();
    view.unmount();
  });
});
