// @vitest-environment jsdom
import { act, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount } from '../../kit/testDom';
import { getSortedMatchedPage } from '../b640Api';
import { makeItem } from './fixtures';
import type { SortState } from './sortModel';
import { useServerSortedList } from './useServerSortedList';

vi.mock('../b640Api', () => ({ getSortedMatchedPage: vi.fn() }));
const read = vi.mocked(getSortedMatchedPage);
const page = (ids: string[], total: number, nextOffset: number | null) => ({
  rows: ids.map((id) => makeItem({ id })),
  total,
  nextOffset,
});

const OTHER: SortState = { key: 'role', dir: 'asc' };

function Probe({ active, sort: initial }: { active: boolean; sort: SortState }) {
  const [sort, setSort] = useState(initial);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const list = useServerSortedList(active, sort, ['CTO'], hidden);
  return (
    <div>
      <button id="sort" onClick={() => setSort(OTHER)} />
      <button id="hide" onClick={() => setHidden(new Set(['a']))} />
      <button id="unhide" onClick={() => setHidden(new Set())} />
      <output data-status={list.status} data-total={list.total} data-more={String(list.hasMore)}>
        {list.rows.map((row) => row.cluster.id).join(',')}
      </output>
      <button id="more" onClick={list.loadMore} />
      <button id="retry" onClick={list.retry} />
    </div>
  );
}

const flush = () => act(async () => {});
const out = (root: HTMLElement) => root.querySelector('output')!;

beforeEach(() => read.mockReset());

describe('серверная сортировка неполной подборки', () => {
  it('выключена — ничего не читает', async () => {
    const view = mount(<Probe active={false} sort={{ key: 'money', dir: 'desc' }} />);
    await flush();
    expect(read).not.toHaveBeenCalled();
    expect(out(view.container).dataset.status).toBe('idle');
    view.unmount();
  });

  it('первая порция, затем дочитывание со следующего смещения', async () => {
    read.mockResolvedValueOnce(page(['a', 'b'], 5, 2)).mockResolvedValueOnce(page(['c'], 5, null));
    const view = mount(<Probe active sort={{ key: 'money', dir: 'desc' }} />);
    expect(out(view.container).dataset.status).toBe('loading');
    await flush();
    expect(read).toHaveBeenCalledWith({ key: 'money', dir: 'desc' }, ['CTO'], 0, expect.anything());
    expect(out(view.container).textContent).toBe('a,b');
    expect(out(view.container).dataset.more).toBe('true');
    click(view.container.querySelector('#more'));
    await flush();
    expect(read).toHaveBeenLastCalledWith(
      { key: 'money', dir: 'desc' },
      ['CTO'],
      2,
      expect.anything(),
    );
    expect(out(view.container).textContent).toBe('a,b,c');
    expect(out(view.container).dataset.more).toBe('false');
    view.unmount();
  });

  it('смена столбца начинает с первой порции и сразу прячет старые строки', async () => {
    read.mockResolvedValueOnce(page(['a'], 3, 1)).mockResolvedValueOnce(page(['z'], 3, 1));
    const view = mount(<Probe active sort={{ key: 'money', dir: 'desc' }} />);
    await flush();
    act(() => {
      view.unmount();
    });
    const next = mount(<Probe active sort={{ key: 'role', dir: 'asc' }} />);
    expect(out(next.container).textContent).toBe('');
    await flush();
    expect(read).toHaveBeenLastCalledWith(
      { key: 'role', dir: 'asc' },
      ['CTO'],
      0,
      expect.anything(),
    );
    expect(out(next.container).textContent).toBe('z');
    next.unmount();
  });

  it('сбой и «Повторить» читают ту же порцию', async () => {
    read.mockRejectedValueOnce(new Error('сеть')).mockResolvedValueOnce(page(['a'], 1, null));
    const view = mount(<Probe active sort={{ key: 'fit', dir: 'asc' }} />);
    await flush();
    expect(out(view.container).dataset.status).toBe('failed');
    click(view.container.querySelector('#retry'));
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(
      { key: 'fit', dir: 'asc' },
      ['CTO'],
      0,
      expect.anything(),
    );
    expect(out(view.container).dataset.status).toBe('ready');
    view.unmount();
  });

  it('скрытая вакансия сдвигает следующую порцию на строку назад', async () => {
    read.mockResolvedValueOnce(page(['a', 'b'], 5, 2)).mockResolvedValueOnce(page(['c'], 4, null));
    const view = mount(<Probe active sort={{ key: 'money', dir: 'desc' }} />);
    await flush();
    click(view.container.querySelector('#hide'));
    expect(out(view.container).dataset.total).toBe('4');
    click(view.container.querySelector('#more'));
    await flush();
    expect(read).toHaveBeenLastCalledWith(
      { key: 'money', dir: 'desc' },
      ['CTO'],
      1,
      expect.anything(),
    );
    view.unmount();
  });

  it('возврат в подборку перечитывает список с первой порции', async () => {
    read
      .mockResolvedValueOnce(page(['a', 'b'], 5, 2))
      .mockResolvedValueOnce(page(['a', 'b'], 5, 2))
      .mockResolvedValueOnce(page(['a', 'b'], 5, 2));
    const view = mount(<Probe active sort={{ key: 'money', dir: 'desc' }} />);
    await flush();
    click(view.container.querySelector('#hide'));
    click(view.container.querySelector('#unhide'));
    await flush();
    expect(read).toHaveBeenLastCalledWith(
      { key: 'money', dir: 'desc' },
      ['CTO'],
      0,
      expect.anything(),
    );
    expect(out(view.container).dataset.total).toBe('5');
    view.unmount();
  });

  it('поздний ответ прежнего столбца не затирает ответ нового', async () => {
    let resolveOld: (value: ReturnType<typeof page>) => void = () => {};
    read
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(page(['new'], 1, null));
    const view = mount(<Probe active sort={{ key: 'money', dir: 'desc' }} />);
    click(view.container.querySelector('#sort'));
    await flush();
    expect(out(view.container).textContent).toBe('new');
    await act(async () => resolveOld(page(['old'], 1, null)));
    expect(out(view.container).textContent).toBe('new');
    view.unmount();
  });
});
