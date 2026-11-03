// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectionApplication } from './applicationSelectionFixture';
import { ResponsesSelectionBar, type ResponsesSelectionBarProps } from './ResponsesSelectionBar';

const api = vi.hoisted(() => ({
  previewApplicationBulk: vi.fn(),
  executeApplicationBulk: vi.fn(),
  listApplicationLabels: vi.fn(),
  createApplicationLabel: vi.fn(),
}));
const download = vi.hoisted(() => ({ triggerFileDownload: vi.fn() }));
vi.mock('./applicationsApi', () => api);
vi.mock('../resume/resumeExport', () => download);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const failed = [
  selectionApplication('a', { failed: true }),
  selectionApplication('b', { failed: true }),
];

describe('ResponsesSelectionBar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    api.previewApplicationBulk.mockResolvedValue({ affectedCount: 2 });
    api.executeApplicationBulk.mockResolvedValue({ state: 'completed', changedCount: 2 });
    api.listApplicationLabels.mockResolvedValue([
      { id: 'l1', name: 'Приоритет', createdAt: '2026-10-01' },
    ]);
    download.triggerFileDownload.mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function render(overrides: Partial<ResponsesSelectionBarProps> = {}) {
    const props: ResponsesSelectionBarProps = {
      selected: failed,
      total: 846,
      allSelectedByFilter: false,
      allowSelectAllFiltered: true,
      query: { stage: ['applied'] },
      onSelectAllFiltered: vi.fn(),
      onClearSelection: vi.fn(),
      onComplete: vi.fn(),
      onNotice: vi.fn(),
      onOpenResume: vi.fn(),
      ...overrides,
    };
    act(() => root.render(<ResponsesSelectionBar {...props} />));
    return props;
  }

  const button = (name: string) =>
    [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === name);

  async function click(name: string) {
    const target = button(name);
    expect(target, name).toBeDefined();
    await act(async () => target?.click());
  }

  it('counts the picked rows and names their shared status', () => {
    render();
    const summary = container.querySelector('.career-responses-selection')?.textContent;
    expect(summary).toContain('Выбрано 2 из 846, все со статусом Не доставлено');
    expect(button('Выбрать все 846 по фильтру')).toBeDefined();
    expect(container.textContent).toContain('Для этого статуса');
    expect(button('Исправить резюме и повторить')).toBeDefined();
  });

  it('keeps only the common actions for a mixed selection', () => {
    render({ selected: [...failed, selectionApplication('c')] });
    expect(container.querySelector('.career-responses-selection')?.textContent).not.toContain(
      'все со статусом',
    );
    expect(button('Повторить отклик')).toBeUndefined();
    expect(button('Закрыть отклики')).toBeDefined();
    expect(button('Добавить метку')).toBeDefined();
    expect(button('Экспорт')).toBeDefined();
  });

  it('closes only the picked rows after confirmation', async () => {
    const props = render();
    await click('Закрыть отклики');
    expect(api.previewApplicationBulk).toHaveBeenCalledWith(
      { stage: ['applied'] },
      { type: 'close' },
      ['a', 'b'],
    );
    await click('Подтвердить: 2');
    expect(api.executeApplicationBulk).toHaveBeenCalledWith(
      { stage: ['applied'] },
      { type: 'close' },
      2,
      ['a', 'b'],
    );
    expect(props.onComplete).toHaveBeenCalledWith('Закрыто 2 откликов.');
  });

  it('sends the whole filter without ids after «Выбрать все по фильтру»', async () => {
    render({ allSelectedByFilter: true });
    expect(container.textContent).toContain('Выбрано 846 из 846');
    await click('Повторить отклик');
    expect(api.previewApplicationBulk).toHaveBeenCalledWith(
      { stage: ['applied'] },
      { type: 'retry' },
      undefined,
    );
  });

  it('queues the retry and then opens the resume', async () => {
    api.executeApplicationBulk.mockResolvedValue({
      state: 'prepared',
      preparedCount: 2,
      sentCount: 0,
      changedCount: 2,
    });
    const props = render();
    await click('Исправить резюме и повторить');
    expect(props.onOpenResume).not.toHaveBeenCalled();
    await click('Подтвердить: 2');
    expect(props.onComplete).toHaveBeenCalledWith('В очередь подготовлено 2; отправлено 0.');
    expect(props.onOpenResume).toHaveBeenCalledTimes(1);
  });

  it('adds a saved label to the picked rows', async () => {
    const props = render();
    await click('Добавить метку');
    await click('Приоритет');
    expect(api.previewApplicationBulk).toHaveBeenCalledWith(
      { stage: ['applied'] },
      { type: 'label', labelId: 'l1' },
      ['a', 'b'],
    );
    await click('Подтвердить: 2');
    expect(props.onComplete).toHaveBeenCalledWith('Метка «Приоритет» добавлена откликам: 2.');
  });

  it('says so instead of offering «Подтвердить: 0»', async () => {
    api.previewApplicationBulk.mockResolvedValue({ affectedCount: 0 });
    render();
    await click('Закрыть отклики');
    expect(button('Подтвердить: 0')).toBeUndefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Все выбранные отклики уже закрыты.',
    );
  });

  it('exports the picked rows as CSV', async () => {
    const props = render();
    await click('Экспорт');
    const [fileName, csv] = download.triggerFileDownload.mock.calls[0] as [string, string];
    expect(fileName).toBe('otkliki.csv');
    expect(csv.trim().split('\n')).toHaveLength(3);
    expect(props.onNotice).toHaveBeenCalledWith('Выгружено откликов: 2.');
    expect(props.onComplete).not.toHaveBeenCalled();
  });
});
