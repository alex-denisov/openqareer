// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';
import { ToggleChecks, useToggleList, type ToggleList } from './ToggleChecks';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

let latest: ToggleList | null = null;
function Probe() {
  const list = useToggleList(['Москва', 'Казань']);
  latest = list;
  return <ToggleChecks list={list} />;
}

describe('useToggleList', () => {
  it('снятая галочка остаётся в списке, но не в отмеченных', () => {
    view = mount(<Probe />);
    click(view.container.querySelector('input'));
    expect(view.container.querySelectorAll('input')).toHaveLength(2);
    expect(latest?.checked).toEqual(['Казань']);
    click(view.container.querySelector('input'));
    expect(latest?.checked).toEqual(['Москва', 'Казань']);
  });

  it('добавление нового и повтор снятого', () => {
    view = mount(<Probe />);
    click(view.container.querySelector('input'));
    act(() => latest?.add('Москва'));
    act(() => latest?.add('Тверь'));
    expect(latest?.items).toEqual(['Москва', 'Казань', 'Тверь']);
    expect(latest?.checked).toEqual(['Москва', 'Казань', 'Тверь']);
  });
});
