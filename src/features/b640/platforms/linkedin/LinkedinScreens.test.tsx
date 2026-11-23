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
vi.mock('../../../today/linkedinDraftApi', async (original) => ({
  ...(await original<typeof import('../../../today/linkedinDraftApi')>()),
  listDrafts: vi.fn(),
  updateDraft: vi.fn(),
  listDraftTopics: vi.fn(),
  createDraft: vi.fn(),
}));

vi.mock('./linkedinProfileApi', () => ({ getLinkedinProfile: vi.fn() }));

vi.mock('./linkedinQueueApi', () => ({
  getRhythm: vi.fn().mockResolvedValue({
    postsPerWeek: 1,
    days: ['fri'],
    time: '10:00',
    timezone: 'Europe/Moscow',
    comments: {
      perDay: 2,
      days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      from: '10:00',
      to: '18:00',
    },
  }),
  listQueue: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 }),
  enqueueDraft: vi.fn(),
  listFeedPosts: vi.fn(),
  createFeedPost: vi.fn(),
  approveFeedPosts: vi.fn(),
  skipFeedPost: vi.fn(),
}));

const queue = await import('./linkedinQueueApi');
const profileApi = await import('./linkedinProfileApi');
const api = await import('../../../today/linkedinDraftApi');

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
// jsdom без matchMedia: широкий экран (Fold и useIsMobile читают медиа-запрос).
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  onchange: null,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
const primaries = (view: { readonly container: HTMLElement }) =>
  [...view.container.querySelectorAll('.is-primary')].map((item) => item.textContent?.trim());
const node = (code: string) => {
  const found = nodeByCode(code);
  if (!found) throw new Error(code);
  return found;
};
const draft = (index: number, patch: Record<string, unknown> = {}) => ({
  id: `d${index}`,
  kind: 'post',
  topic: `Тема ${index}`,
  text: `Текст ${index}`,
  status: 'draft',
  ...patch,
});
const many = (count: number, kind = 'post', status = 'published') =>
  Array.from({ length: count }, (_, i) => draft(i, { kind, status }));

afterEach(() => vi.clearAllMocks());

describe('a03: профиль LinkedIn', () => {
  it('без импорта LinkedIn: строка с «Импортировать из LinkedIn»', async () => {
    vi.mocked(profileApi.getLinkedinProfile).mockResolvedValue({ kind: 'no_import' });
    const view = mount(<Section node={node('a03')} params={{}} />);
    await flush();
    expect(view.container.querySelector('.li-off a.btn')!.textContent).toContain(
      'Импортировать из LinkedIn',
    );
    expect(view.container.querySelector('.li-sec')).toBeNull();
    view.unmount();
  });
  it('ошибка чтения: «Повторить» на месте', async () => {
    vi.mocked(profileApi.getLinkedinProfile).mockRejectedValue(new Error('x'));
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
    const more = [...view.container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Показать ещё'),
    )!;
    await act(async () => click(more));
    expect(view.container.querySelectorAll('li.li-pub')).toHaveLength(27);
    view.unmount();
  });
  it('посты: текущий черновик с «Скопировать»; без черновика — «Подготовить черновик»', async () => {
    vi.mocked(api.listDrafts).mockResolvedValue([draft(1)] as never);
    const view = mount(<Section node={node('a03b')} params={{}} />);
    await flush();
    expect((view.container.querySelector('#po-text') as HTMLTextAreaElement).value).toBe('Текст 1');
    expect(view.container.textContent).toContain('Одобрить и поставить в план');
    expect(view.container.textContent).toContain('не больше 1 поста в неделю');
    view.unmount();
    vi.mocked(api.listDrafts).mockResolvedValue([] as never);
    const empty = mount(<Section node={node('a03b')} params={{}} />);
    await flush();
    expect(empty.container.textContent).toContain('Подготовить черновик');
    empty.unmount();
  });
  it('«Одобрить и поставить в план»: одобряет черновик и ставит его в очередь', async () => {
    vi.mocked(api.listDrafts).mockResolvedValue([draft(1)] as never);
    vi.mocked(api.updateDraft).mockResolvedValue({} as never);
    vi.mocked(queue.enqueueDraft).mockResolvedValue({ scheduledAt: '2026-11-20T07:00:00.000Z' });
    const view = mount(<Section node={node('a03b')} params={{}} />);
    await flush();
    const approve = [...view.container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Одобрить'),
    )!;
    await act(async () => click(approve));
    await flush();
    expect(api.updateDraft).toHaveBeenCalledWith('d1', { status: 'approved' });
    expect(queue.enqueueDraft).toHaveBeenCalledWith('d1');
    expect(view.container.textContent).toContain('Поставили в план');
    view.unmount();
  });
  it('лента без постов: пустое состояние и форма «Добавить пост»', async () => {
    vi.mocked(queue.listFeedPosts).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 });
    const view = mount(<Section node={node('a05')} params={{}} />);
    await flush();
    expect(view.container.querySelector('.vl-empty-t')!.textContent).toBe('Новых постов нет');
    expect(view.container.querySelector('#fp-text')).not.toBeNull();
    // a05h: «Изменить темы» под строкой «Новых постов нет».
    expect(
      [...view.container.querySelectorAll('a')].some((a) =>
        a.textContent?.includes('Изменить темы'),
      ),
    ).toBe(true);
    // B645-2: «Изменить темы» внутри пустого блока, сразу под «Новых постов нет».
    expect(
      view.container.querySelector('.vl-empty-t + .actions a.btn.is-primary')?.textContent,
    ).toBe('Изменить темы');
    // Главная кнопка на a05h одна — «Изменить темы»; «Подготовить комментарий» обычная.
    expect(
      [...view.container.querySelectorAll('.is-primary')].map((item) => item.textContent),
    ).toEqual(['Изменить темы']);
    view.unmount();
  });
  it('a05b: без новых черновиков главная — «Настроить ритм»', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    vi.mocked(queue.listFeedPosts).mockResolvedValue({
      items: [
        {
          draftId: 'f1',
          postUrl: null,
          postExcerpt: 'Пост',
          comment: 'К',
          state: 'queued',
          createdAt: at,
          scheduledAt: null,
        },
      ],
      total: 1,
      offset: 0,
      limit: 20,
    } as never);
    vi.mocked(queue.listQueue).mockResolvedValue({
      items: [
        {
          id: 'q1',
          draftId: 'c1',
          kind: 'comment',
          text: 'В очереди',
          scheduledAt: at,
          state: 'queued',
          updatedAt: at,
          remindedAt: null,
          openUrl: null,
        },
      ],
      total: 1,
      offset: 0,
      limit: 20,
      paused: false,
    } as never);
    const view = mount(<Section node={node('a05')} params={{}} />);
    await flush();
    expect(primaries(view)).toEqual(['Настроить ритм']);
    view.unmount();
  });
  it('лента a05: «N постов · Сегодня осталось X из Y», меню «Изменить темы», очередь комментариев с ритмом', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    vi.mocked(queue.listFeedPosts).mockResolvedValue({
      items: [
        {
          draftId: 'f1',
          postUrl: null,
          postExcerpt: 'Пост',
          comment: 'К',
          state: 'draft',
          createdAt: at,
          scheduledAt: null,
        },
      ],
      total: 1,
      offset: 0,
      limit: 20,
    } as never);
    vi.mocked(queue.listQueue).mockResolvedValue({
      items: [
        {
          id: 'q1',
          draftId: 'c1',
          kind: 'comment',
          text: 'В очереди',
          scheduledAt: at,
          state: 'queued',
          updatedAt: at,
          remindedAt: null,
          openUrl: null,
        },
      ],
      total: 1,
      offset: 0,
      limit: 20,
      paused: false,
    } as never);
    const view = mount(<Section node={node('a05')} params={{}} />);
    await flush();
    // a05: главная одна — «Одобрить» первой карточки; «Подготовить комментарий» и «Настроить ритм» обычные.
    expect(primaries(view)).toEqual(['Одобрить']);
    const heading = view.container.querySelector('#cm-title')!.textContent!;
    expect(heading).toMatch(/^1 пост · Сегодня осталось [0-2] из 2$/u);
    const menu = view.container.querySelector('.list-head .lk-menu')!;
    expect(menu.querySelector('button')!.getAttribute('aria-label')).toBe(
      'Ещё действия: комментарии',
    );
    click(menu.querySelector('button'));
    expect(menu.querySelector('[role="menuitem"]')!.textContent).toBe('Изменить темы');
    expect(view.container.querySelector('#cq-title')!.textContent).toBe('1 комментарий в очереди');
    expect(view.container.textContent).toContain('Настроить ритм');
    view.unmount();
  });
  it('лента: после «Пропустить» первая карточка показывает свой черновик, а не прежний', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const item = (draftId: string, comment: string) => ({
      draftId,
      postUrl: null,
      postExcerpt: `Пост ${draftId}`,
      comment,
      state: 'draft',
      createdAt: at,
      scheduledAt: null,
    });
    const page = (items: unknown[]) => ({ items, total: items.length, offset: 0, limit: 20 });
    vi.mocked(queue.listFeedPosts)
      .mockResolvedValueOnce(
        page([item('a', 'Комментарий A'), item('b', 'Комментарий B')]) as never,
      )
      .mockResolvedValue(page([item('b', 'Комментарий B')]) as never);
    vi.mocked(queue.skipFeedPost).mockResolvedValue({ draftId: 'a', skipped: true } as never);
    const view = mount(<Section node={node('a05')} params={{}} />);
    await flush();
    const field = () => view.container.querySelector<HTMLTextAreaElement>('textarea.lk-draft')!;
    expect(field().value).toBe('Комментарий A');
    const skip = [...view.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Пропустить',
    );
    click(skip ?? null);
    await flush();
    await flush();
    expect(field().value).toBe('Комментарий B');
    view.unmount();
  });
  it('лента: карточки, «Одобрить» и пакетное «Одобрить все»', async () => {
    const post = (n: number) => ({
      draftId: `f${n}`,
      postUrl: null,
      postExcerpt: `Пост ${n}`,
      comment: `Комментарий ${n}`,
      state: 'draft',
      createdAt: '2026-11-18T10:00:00Z',
      scheduledAt: null,
    });
    vi.mocked(queue.listFeedPosts).mockResolvedValue({
      items: [post(1), post(2)],
      total: 2,
      offset: 0,
      limit: 20,
    } as never);
    vi.mocked(queue.approveFeedPosts).mockResolvedValue({ results: [] });
    const view = mount(<Section node={node('a05')} params={{}} />);
    await flush();
    expect(view.container.querySelectorAll('.lk-card')).toHaveLength(2);
    expect(view.container.querySelector('.lk-au')).toBeNull();
    const all = [...view.container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Одобрить все'),
    )!;
    await act(async () => click(all));
    expect(queue.approveFeedPosts).toHaveBeenCalledWith(['f1', 'f2']);
    view.unmount();
  });
  it('лента: принести пост — текст обязателен, ссылка нет', async () => {
    vi.mocked(queue.listFeedPosts).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 });
    vi.mocked(queue.createFeedPost).mockResolvedValue({
      draftId: 'f1',
      postUrl: null,
      postExcerpt: 'x',
      comment: 'y',
    });
    const view = mount(<Section node={node('a05')} params={{}} />);
    await flush();
    const submit = view.container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    view.unmount();
  });
});
