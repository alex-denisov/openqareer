// @vitest-environment jsdom
import { act, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount } from '../../kit/testDom';
import { getHiddenVacancies, type HiddenRow } from '../b640Api';
import { makeItem } from './fixtures';
import { useHiddenVacancies } from './useHiddenVacancies';

vi.mock('../b640Api', () => ({ getHiddenVacancies: vi.fn() }));
const read = vi.mocked(getHiddenVacancies);
const at = '2026-11-11T09:00:00Z';
const hidden = (id: string): HiddenRow => ({
  ...makeItem({ id }),
  hidden: { reasonId: 'stale', at },
});
const page = (ids: string[], total: number, nextOffset: number | null) => ({
  rows: ids.map(hidden),
  total,
  nextOffset,
});

function Probe({ enabled, session: initial = [] }: { enabled: boolean; session?: HiddenRow[] }) {
  const [session, setSession] = useState(initial);
  const list = useHiddenVacancies(enabled, session);
  return (
    <div>
      <button id="add" onClick={() => setSession([hidden('s')])} />
      <output data-status={list.status} data-left={list.left}>
        {list.rows.map((row) => row.cluster.id).join(',')}
      </output>
      <button id="more" onClick={list.loadMore} />
      <button id="retry" onClick={list.retry} />
      <button id="remove" onClick={() => list.remove('a')} />
    </div>
  );
}
const flush = () => act(async () => {});
const out = (root: HTMLElement) => root.querySelector('output')!;

beforeEach(() => read.mockReset());

describe('скрытые вакансии раздела', () => {
  it('пока чип выключен, ничего не читает', async () => {
    const view = mount(<Probe enabled={false} />);
    await flush();
    expect(read).not.toHaveBeenCalled();
    view.unmount();
  });

  it('читает первую порцию и дочитывает следующую', async () => {
    read.mockResolvedValueOnce(page(['a', 'b'], 3, 2)).mockResolvedValueOnce(page(['c'], 3, null));
    const view = mount(<Probe enabled />);
    expect(out(view.container).dataset.status).toBe('loading');
    await flush();
    expect(out(view.container).textContent).toBe('a,b');
    expect(out(view.container).dataset.left).toBe('1');
    click(view.container.querySelector('#more'));
    await flush();
    expect(read).toHaveBeenLastCalledWith(2, expect.anything());
    expect(out(view.container).textContent).toBe('a,b,c');
    view.unmount();
  });

  it('скрытое в этой сессии видно сразу, повтор с сервера не двоится', async () => {
    read.mockResolvedValueOnce(page(['a', 's'], 2, null));
    const view = mount(<Probe enabled session={[hidden('s')]} />);
    expect(out(view.container).textContent).toBe('s');
    await flush();
    expect(out(view.container).textContent).toBe('s,a');
    view.unmount();
  });

  it('сбой — статус failed, «Повторить» читает ту же порцию', async () => {
    read.mockRejectedValueOnce(new Error('сеть')).mockResolvedValueOnce(page([], 0, null));
    const view = mount(<Probe enabled />);
    await flush();
    expect(out(view.container).dataset.status).toBe('failed');
    click(view.container.querySelector('#retry'));
    await flush();
    expect(read).toHaveBeenLastCalledWith(0, expect.anything());
    expect(out(view.container).dataset.status).toBe('ready');
    expect(out(view.container).textContent).toBe('');
    view.unmount();
  });

  it('возвращённая вакансия уходит из списка', async () => {
    read.mockResolvedValueOnce(page(['a', 'b'], 2, null));
    const view = mount(<Probe enabled />);
    await flush();
    click(view.container.querySelector('#remove'));
    expect(out(view.container).textContent).toBe('b');
    view.unmount();
  });

  it('скрыли ещё одну во время просмотра: сдвинутая порция не двоит строку и не завышает остаток', async () => {
    read
      .mockResolvedValueOnce(page(['a', 'b'], 3, 2))
      .mockResolvedValueOnce(page(['b', 'c'], 4, null));
    const view = mount(<Probe enabled />);
    await flush();
    click(view.container.querySelector('#add'));
    click(view.container.querySelector('#more'));
    await flush();
    expect(out(view.container).textContent).toBe('s,a,b,c');
    expect(out(view.container).dataset.left).toBe('0');
    view.unmount();
  });
});
