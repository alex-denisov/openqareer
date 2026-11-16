// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from './testDom';
import { PagedList } from './PagedList';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

const items = Array.from({ length: 45 }, (_, index) => `Контакт ${index + 1}`);
const render = (item: string) => <li key={item}>{item}</li>;
const rows = (v: Mounted) => v.container.querySelectorAll('ul > li').length;
const more = (v: Mounted) => v.container.querySelector('.vl-foot button') as HTMLButtonElement;

describe('PagedList', () => {
  it('сначала 20, счётчик и «Показать ещё 20»', () => {
    view = mount(<PagedList items={items} renderItem={render} />);
    expect(rows(view)).toBe(20);
    expect(view.container.querySelector('.vl-foot .ct-count')?.textContent).toBe('20 из 45');
    expect(more(view).textContent).toBe('Показать ещё 20');
  });
  it('нажатие добавляет порцию, последняя порция короче, кнопка исчезает', () => {
    view = mount(<PagedList items={items} renderItem={render} />);
    click(more(view));
    expect(rows(view)).toBe(40);
    expect(more(view).textContent).toBe('Показать ещё 5');
    click(more(view));
    expect(rows(view)).toBe(45);
    expect(view.container.querySelector('.vl-foot button')).toBeNull();
  });
  it('total больше загруженного: догрузка по onLoadMore, ожидание на кнопке', async () => {
    let finish: () => void = () => undefined;
    const onLoadMore = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    view = mount(
      <PagedList items={items.slice(0, 20)} renderItem={render} total={1500} onLoadMore={onLoadMore} />,
    );
    expect(view.container.querySelector('.ct-count')?.textContent).toContain('20 из');
    click(more(view));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(more(view).getAttribute('aria-busy')).toBe('true');
    await act(async () => finish());
    expect(more(view).getAttribute('aria-busy')).toBeNull();
  });
  it('ошибка догрузки — под списком, список остался', async () => {
    const onLoadMore = vi.fn(() => Promise.reject(new Error('x')));
    view = mount(
      <PagedList items={items.slice(0, 20)} renderItem={render} total={100} onLoadMore={onLoadMore} />,
    );
    await act(async () => more(view as Mounted).click());
    expect(view.container.querySelector('.re-line.is-err')?.textContent).toContain('Не удалось');
    expect(rows(view)).toBe(20);
  });
});
