// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../kit/testDom';
import { DraftEditor } from './DraftEditor';

vi.mock('./postVariantsApi', () => ({ listPostVariants: vi.fn(), createPostVariant: vi.fn() }));
vi.mock('../../../today/linkedinDraftApi', () => ({ updateDraft: vi.fn() }));
vi.mock('./linkedinQueueApi', () => ({ enqueueDraft: vi.fn() }));
vi.mock('../../../tariffs/useTariffQuotas', () => ({ useTariffQuotas: vi.fn() }));

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
const variantsApi = await import('./postVariantsApi');
const draftApi = await import('../../../today/linkedinDraftApi');
const queueApi = await import('./linkedinQueueApi');
const quotas = await import('../../../tariffs/useTariffQuotas');

const DRAFT = {
  id: 'd1',
  kind: 'post',
  topic: 'Релиз за день',
  text: 'Текст черновика',
  status: 'draft',
} as const;
const variant = (position: number) => ({
  id: `v${position}`,
  position,
  text: `Вариант ${position}`,
  wish: { chips: ['shorter'] as const, text: '' },
  createdAt: '2026-11-23T10:00:00.000Z',
  payload: null,
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
const field = () => view!.container.querySelector<HTMLTextAreaElement>('#po-text')!;

async function render(quota: unknown = null) {
  vi.mocked(quotas.useTariffQuotas).mockReturnValue(quota as never);
  vi.mocked(variantsApi.listPostVariants).mockResolvedValue({ variants: [], remaining: 3 });
  await act(async () => {
    view = mount(
      <DraftEditor draft={DRAFT} onChanged={() => undefined} onPlaced={() => undefined} />,
    );
  });
  await flush();
}

async function makeVariant() {
  vi.mocked(variantsApi.createPostVariant).mockResolvedValue({
    variant: variant(1),
    variants: [variant(1)],
    remaining: 2,
  });
  await act(async () => click(button('Другой вариант')!));
  await act(async () => click(button('Короче')!));
  await act(async () => click(button('Сделать вариант')!));
  await flush();
}

describe('B694 a03b: «Другой вариант» поста', () => {
  it('вместо «Скопировать» — «Другой вариант · 3», листать пока нечего', async () => {
    await render();
    expect(button('Скопировать')).toBeUndefined();
    expect(button('Другой вариант')?.textContent).toBe('Другой вариант · 3');
    expect(view!.container.querySelector('.var-sw')).toBeNull();
    expect(variantsApi.listPostVariants).toHaveBeenCalledWith('post', 'd1', expect.anything());
  });

  it('вариант с пожеланием встаёт в поле, листание возвращает черновик с правкой', async () => {
    await render();
    await makeVariant();
    expect(variantsApi.createPostVariant).toHaveBeenCalledWith('d1', {
      chips: ['shorter'],
      text: '',
    });
    expect(field().value).toBe('Вариант 1');
    expect(view!.container.querySelector('.var-sw .num')?.textContent).toBe('2 из 2');
    expect(button('Другой вариант')?.textContent).toBe('Другой вариант · 2');
    await act(async () =>
      click(view!.container.querySelector<HTMLButtonElement>('[aria-label="Предыдущий вариант"]')!),
    );
    expect(field().value).toBe('Текст черновика');
    expect(view!.container.querySelector('[aria-label="Варианты поста"]')).not.toBeNull();
  });

  it('одобряется текст, что в поле: выбранный вариант', async () => {
    vi.mocked(draftApi.updateDraft).mockResolvedValue({} as never);
    vi.mocked(queueApi.enqueueDraft).mockResolvedValue({
      scheduledAt: '2026-11-24T07:00:00.000Z',
    } as never);
    await render();
    await makeVariant();
    await act(async () => click(button('Одобрить')!));
    await flush();
    expect(draftApi.updateDraft).toHaveBeenCalledWith('d1', { text: 'Вариант 1' });
    expect(draftApi.updateDraft).toHaveBeenCalledWith('d1', { status: 'approved' });
  });

  it('ошибка сервера остаётся во всплывашке', async () => {
    await render();
    vi.mocked(variantsApi.createPostVariant).mockRejectedValue(
      new Error('Для этого черновика нужен другой тариф.'),
    );
    await act(async () => click(button('Другой вариант')!));
    await act(async () => click(button('Сделать вариант')!));
    await flush();
    expect(view!.container.querySelector('.va-pop')?.textContent).toContain(
      'Другой вариант не собрался. Повторите.',
    );
    expect(field().value).toBe('Текст черновика');
  });

  it('ⓘ «О посте»: остаток черновиков за месяц; без остатка подсказки нет', async () => {
    const quota = {
      key: 'linkedin_drafts',
      label: 'Черновики LinkedIn',
      limit: 90,
      used: 2,
      remaining: 88,
      upgradePlan: null,
    };
    await render({
      plan: 'pro',
      unlimited: false,
      period: null,
      quotas: [quota],
      fitPercentLimit: null,
    });
    const tip = view!.container.querySelector('h2.po-name .tip');
    expect(tip?.querySelector('[aria-label="О посте"]')).not.toBeNull();
    expect(tip?.querySelector('[role="tooltip"]')?.textContent).toBe(
      'Ваши посты: осталось 88 из 90 в этом месяце.',
    );
    view!.unmount();
    await render({
      plan: 'pro',
      unlimited: true,
      period: null,
      quotas: [quota],
      fitPercentLimit: null,
    });
    expect(view!.container.querySelector('h2.po-name .tip')).toBeNull();
  });
});
