// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../shared/geo/serverGeoDirectory';
import { CareerInlineGeoEditor } from './CareerConditionsComponents';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const chips = (node: HTMLElement) =>
  [...node.querySelectorAll('.career-geo-chip-label')].map((chip) => chip.textContent);

describe('«Города и регионы поиска» — выбор из справочника', () => {
  it('выбирает «Москву» из списка с клавиатуры и сохраняет', () => {
    const onSave = vi.fn();
    const node = mount(
      <CareerInlineGeoEditor initialSelected={[]} onSave={onSave} onCancel={vi.fn()} />,
    );
    const input = node.querySelector<HTMLInputElement>('#geo-input')!;
    expect(input.getAttribute('role')).toBe('combobox');
    type(input, 'Моск');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    press(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    press(input, 'Enter');
    expect(chips(node)).toEqual(['Москва']);
    act(() => node.querySelector<HTMLButtonElement>('[aria-label="Сохранить"]')!.click());
    expect(onSave).toHaveBeenCalledWith(['Москва']);
  });

  it('не принимает свободный текст', () => {
    const onSave = vi.fn();
    const node = mount(
      <CareerInlineGeoEditor initialSelected={[]} onSave={onSave} onCancel={vi.fn()} />,
    );
    const input = node.querySelector<HTMLInputElement>('#geo-input')!;
    type(input, 'Нигдеград');
    press(input, 'Enter');
    expect(chips(node)).toEqual([]);
    expect(node.textContent).toContain('Нет такого места');
  });

  it('предлагает удалённую работу и переводит старые значения в записи справочника', () => {
    const node = mount(
      <CareerInlineGeoEditor
        initialSelected={['Moscow', 'Удалённо из РФ']}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(chips(node)).toEqual(['Москва', 'Удалённо из РФ']);
    const input = node.querySelector<HTMLInputElement>('#geo-input')!;
    type(input, 'удал');
    expect(node.querySelector('[role="listbox"]')!.textContent).toContain(
      'Удалённо из любой страны',
    );
  });

  it('Backspace в пустом поле снимает последнее место', () => {
    const node = mount(
      <CareerInlineGeoEditor
        initialSelected={['Москва', 'Германия']}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    press(node.querySelector('#geo-input')!, 'Backspace');
    expect(chips(node)).toEqual(['Москва']);
  });
});
