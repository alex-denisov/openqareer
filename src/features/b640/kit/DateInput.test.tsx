// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from './testDom';
import { DateInput } from './DateInput';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function type(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

function input(): HTMLInputElement {
  return view!.container.querySelector('input')!;
}

describe('DateInput (B733)', () => {
  it('текстовое поле «дд.мм.гггг» показывает ISO-значение по-русски', () => {
    view = mount(<DateInput id="d" value="2026-12-01" onChange={() => undefined} />);
    expect(input().type).toBe('text');
    expect(input().inputMode).toBe('numeric');
    expect(input().placeholder).toBe('дд.мм.гггг');
    expect(input().value).toBe('01.12.2026');
  });

  it('набор цифр ставит точки и отдаёт ISO, пока дата не полная — пустое значение', () => {
    const onChange = vi.fn();
    view = mount(<DateInput id="d" value="" onChange={onChange} />);
    type(input(), '011');
    expect(input().value).toBe('01.1');
    expect(onChange).not.toHaveBeenCalled();
    type(input(), '01122026');
    expect(input().value).toBe('01.12.2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-12-01');
  });

  it('несуществующая дата — ошибка формата после ухода с поля и пустое значение', () => {
    const onChange = vi.fn();
    view = mount(<DateInput id="d" value="2026-12-01" onChange={onChange} />);
    type(input(), '31.02.2026');
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(view.container.querySelector('[role=alert]')).toBeNull();
    blur(input());
    expect(view.container.querySelector('[role=alert]')?.textContent).toBe(
      'Дата в виде дд.мм.гггг',
    );
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('дата позже max не принимается', () => {
    const onChange = vi.fn();
    view = mount(<DateInput id="d" value="" max="2026-11-22" onChange={onChange} />);
    type(input(), '23.11.2026');
    blur(input());
    expect(onChange).not.toHaveBeenCalledWith('2026-11-23');
    expect(view.container.querySelector('[role=alert]')?.textContent).toBe('Не позже 22.11.2026');
  });

  it('ошибка формы показывается, пока нет ошибки формата', () => {
    view = mount(
      <DateInput id="d" value="" error="Укажите день выхода" onChange={() => undefined} />,
    );
    expect(view.container.querySelector('[role=alert]')?.textContent).toBe('Укажите день выхода');
  });

  it('значение, поставленное снаружи, заменяет набранный текст', () => {
    let set: (value: string) => void = () => undefined;
    function Host() {
      const [value, setValue] = useState('');
      set = setValue;
      return <DateInput id="d" value={value} onChange={setValue} />;
    }
    view = mount(<Host />);
    type(input(), '01.1');
    act(() => set('2027-03-05'));
    expect(input().value).toBe('05.03.2027');
    act(() => set(''));
    expect(input().value).toBe('');
  });
});
