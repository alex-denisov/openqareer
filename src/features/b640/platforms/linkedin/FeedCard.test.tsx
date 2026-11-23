// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedPostItem } from '../../../../../shared/b640FeedComments';
import { click, mount, type Mounted } from '../../kit/testDom';
import { FeedCard } from './FeedCard';

vi.mock('./postVariantsApi', () => ({ listPostVariants: vi.fn(), createPostVariant: vi.fn() }));
vi.mock('../../../today/linkedinDraftApi', () => ({ updateDraft: vi.fn() }));
vi.mock('./linkedinQueueApi', () => ({ skipFeedPost: vi.fn() }));

// jsdom без matchMedia: широкий экран (useIsMobile читает медиа-запрос).
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

const variantsApi = await import('./postVariantsApi');
const draftApi = await import('../../../today/linkedinDraftApi');
const queueApi = await import('./linkedinQueueApi');

const post = (patch: Partial<FeedPostItem> = {}): FeedPostItem => ({
  draftId: 'f1',
  postUrl: null,
  postExcerpt: 'Пост про релизы',
  comment: 'Черновик комментария',
  state: 'draft',
  createdAt: '2026-11-23T10:00:00.000Z',
  scheduledAt: null,
  ...patch,
});

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.clearAllMocks();
});
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const button = (text: string) =>
  [...view!.container.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
const field = () => view!.container.querySelector<HTMLTextAreaElement>('textarea.lk-draft')!;

async function render(item = post(), approve = vi.fn(), onChanged = vi.fn()) {
  vi.mocked(variantsApi.listPostVariants).mockResolvedValue({ variants: [], remaining: 3 });
  await act(async () => {
    view = mount(<FeedCard post={item} first approve={approve} onChanged={onChanged} />);
  });
  await flush();
  return { approve, onChanged };
}

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(field(), value);
  field().dispatchEvent(new Event('input', { bubbles: true }));
}

describe('B694 a05: карточка комментария по макету', () => {
  it('черновик правится; «Другой вариант · 3» и «Пропустить» — row-act; «Скопировать» нет', async () => {
    await render();
    expect(field().readOnly).toBe(false);
    expect(button('Скопировать')).toBeUndefined();
    expect(button('Другой вариант')?.className).toBe('row-act');
    expect(button('Другой вариант')?.textContent).toBe('Другой вариант · 3');
    expect(button('Пропустить')?.className).toBe('row-act');
    expect(variantsApi.listPostVariants).toHaveBeenCalledWith('f1', expect.anything());
  });

  it('«Одобрить» сначала сохраняет правку, потом ставит в очередь', async () => {
    vi.mocked(draftApi.updateDraft).mockResolvedValue({} as never);
    const { approve } = await render();
    await act(async () => type('Мой текст'));
    await act(async () => click(button('Одобрить')!));
    await flush();
    expect(draftApi.updateDraft).toHaveBeenCalledWith('f1', { text: 'Мой текст' });
    expect(approve).toHaveBeenCalledWith(['f1']);
    expect(vi.mocked(draftApi.updateDraft).mock.invocationCallOrder[0]!).toBeLessThan(
      approve.mock.invocationCallOrder[0]!,
    );
  });

  it('«Одобрить» без правки текст не пишет', async () => {
    const { approve } = await render();
    await act(async () => click(button('Одобрить')!));
    await flush();
    expect(draftApi.updateDraft).not.toHaveBeenCalled();
    expect(approve).toHaveBeenCalledWith(['f1']);
  });

  it('«Пропустить» снимает пост с радара своим маршрутом, лента перечитана', async () => {
    vi.mocked(queueApi.skipFeedPost).mockResolvedValue({ draftId: 'f1', skipped: true });
    const { onChanged } = await render();
    await act(async () => click(button('Пропустить')!));
    await flush();
    expect(queueApi.skipFeedPost).toHaveBeenCalledWith('f1');
    expect(draftApi.updateDraft).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it('сбой «Пропустить» — строка ошибки на месте, лента не перечитана', async () => {
    vi.mocked(queueApi.skipFeedPost).mockRejectedValue(new Error('down'));
    const { onChanged } = await render();
    await act(async () => click(button('Пропустить')!));
    await flush();
    expect(view!.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('в очереди: текст только для чтения, вариантов и «Пропустить» нет', async () => {
    await render(post({ state: 'queued', scheduledAt: '2026-11-24T07:00:00.000Z' }));
    expect(field().readOnly).toBe(true);
    expect(button('Другой вариант')).toBeUndefined();
    expect(button('Пропустить')).toBeUndefined();
    expect(variantsApi.listPostVariants).not.toHaveBeenCalled();
  });

  it('одобрен, но снят с очереди (без слота): «Пропустить» есть, тупика нет', async () => {
    vi.mocked(queueApi.skipFeedPost).mockResolvedValue({ draftId: 'f1', skipped: true });
    const { onChanged } = await render(post({ state: 'approved', scheduledAt: null }));
    expect(field().readOnly).toBe(true);
    expect(button('Одобрить')).toBeUndefined();
    expect(button('Другой вариант')).toBeUndefined();
    await act(async () => click(button('Пропустить')!));
    await flush();
    expect(queueApi.skipFeedPost).toHaveBeenCalledWith('f1');
    expect(onChanged).toHaveBeenCalled();
  });
});
