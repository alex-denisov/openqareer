// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, press, type Mounted } from './testDom';
import { Composer } from './Composer';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function typeText(v: Mounted, value: string): HTMLTextAreaElement {
  const area = v.container.querySelector('textarea.cmp-in') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return area;
}

describe('Composer', () => {
  it('разметка макета', () => {
    view = mount(
      <Composer
        label="Ваш вопрос консультанту"
        placeholder="Спросите своими словами"
        onSubmit={() => undefined}
      />,
    );
    const form = view.container.querySelector('form.compose.cmp') as HTMLFormElement;
    expect(form.dataset.mode).toBe('text');
    const area = form.querySelector('textarea.cmp-in') as HTMLTextAreaElement;
    expect(form.querySelector('label.vh')?.getAttribute('for')).toBe(area.id);
    expect(area.placeholder).toBe('Спросите своими словами');
    expect(form.querySelector('button.cmp-send[type=submit]')?.getAttribute('aria-label')).toBe(
      'Отправить',
    );
    expect(form.querySelector('.cmp-mode')).toBeNull();
  });
  it('has-text появляется с текстом', () => {
    view = mount(<Composer label="Вопрос" placeholder="…" onSubmit={() => undefined} />);
    typeText(view, 'Привет');
    expect(view.container.querySelector('form')?.classList.contains('has-text')).toBe(true);
  });
  it('Enter отправляет и очищает, Shift+Enter — нет', () => {
    const onSubmit = vi.fn();
    view = mount(<Composer label="Вопрос" placeholder="…" onSubmit={onSubmit} />);
    const area = typeText(view, '  Как сменить роль?  ');
    press(area, 'Enter', { shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    press(area, 'Enter');
    expect(onSubmit).toHaveBeenCalledWith('Как сменить роль?');
    expect(area.value).toBe('');
  });
  it('занято: отправка недоступна', () => {
    const onSubmit = vi.fn();
    view = mount(<Composer label="Вопрос" placeholder="…" busy onSubmit={onSubmit} />);
    const area = typeText(view, 'Текст');
    press(area, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(view.container.querySelector('.cmp-send')?.getAttribute('aria-busy')).toBe('true');
  });
  it('меню способов ввода и отказ микрофона', async () => {
    const onVoice = vi.fn(() => Promise.reject(new Error('denied')));
    view = mount(
      <Composer label="Вопрос" placeholder="…" onSubmit={() => undefined} onVoice={onVoice} />,
    );
    const caret = view.container.querySelector('.cmp-caret') as HTMLElement;
    expect(caret.getAttribute('aria-expanded')).toBe('false');
    click(caret);
    expect(caret.getAttribute('aria-expanded')).toBe('true');
    const items = view.container.querySelectorAll('.cmp-menu [role=menuitemradio]');
    expect(Array.from(items).map((i) => i.textContent)).toEqual(['Текстом', 'Голосом']);
    await act(async () => (items[1] as HTMLElement).click());
    expect(view.container.querySelector('.cmp-toast')?.textContent).toBe('Нет доступа к микрофону');
    expect(view.container.querySelector('form')?.dataset.mode).toBe('text');
  });
  it('голос доступен: режим меняется', async () => {
    view = mount(
      <Composer
        label="Вопрос"
        placeholder="…"
        onSubmit={() => undefined}
        onVoice={() => Promise.resolve()}
      />,
    );
    click(view.container.querySelector('.cmp-caret'));
    const items = view.container.querySelectorAll('.cmp-menu [role=menuitemradio]');
    await act(async () => (items[1] as HTMLElement).click());
    expect(view.container.querySelector('form')?.dataset.mode).toBe('voice');
    expect(view.container.querySelector('.cmp-send')?.getAttribute('aria-label')).toBe(
      'Надиктовать',
    );
  });
});
