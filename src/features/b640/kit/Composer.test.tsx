// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, press, type Mounted } from './testDom';
import { Composer } from './Composer';

let view: Mounted | null = null;
const idle = {
  supported: false,
  recording: false,
  settling: false,
  denied: false,
  start: () => undefined,
  stop: () => undefined,
};
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
  it('закрытый ввод: строка сверху, поле и отправка недоступны', () => {
    const onSubmit = vi.fn();
    view = mount(
      <Composer
        label="Вопрос"
        placeholder="…"
        onSubmit={onSubmit}
        closed={<span className="cmp-line-t">Лимит сообщений исчерпан</span>}
        dictation={{ ...idle, supported: true }}
      />,
    );
    const form = view.container.querySelector('form.compose.cmp.is-off') as HTMLFormElement;
    expect(form.querySelector('p.cmp-line[role=status]')?.textContent).toBe(
      'Лимит сообщений исчерпан',
    );
    expect((form.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect((form.querySelector('.cmp-send') as HTMLButtonElement).disabled).toBe(true);
    expect((form.querySelector('.cmp-caret') as HTMLButtonElement).disabled).toBe(true);
    act(() => form.requestSubmit());
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('управляемый текст: значение и правки идут через владельца, после отправки — пусто', () => {
    const onText = vi.fn();
    const onSubmit = vi.fn();
    view = mount(
      <Composer label="Вопрос" placeholder="…" onSubmit={onSubmit} text="Готово" onText={onText} />,
    );
    const area = view.container.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).toBe('Готово');
    expect(view.container.querySelector('form')?.classList.contains('has-text')).toBe(true);
    typeText(view, 'Готово!');
    expect(onText).toHaveBeenLastCalledWith('Готово!');
    press(area, 'Enter');
    expect(onSubmit).toHaveBeenCalledWith('Готово');
    expect(onText).toHaveBeenLastCalledWith('');
  });
  it('диктовка: пустое поле начинает запись, запись останавливается той же кнопкой', async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const onSubmit = vi.fn();
    const render = (recording: boolean) => (
      <Composer
        label="Вопрос"
        placeholder="…"
        onSubmit={onSubmit}
        dictation={{ ...idle, supported: true, recording, start, stop }}
      />
    );
    view = mount(render(false));
    click(view.container.querySelector('.cmp-caret'));
    await act(async () =>
      (view?.container.querySelectorAll('.cmp-menu [role=menuitemradio]')[1] as HTMLElement).click(),
    );
    expect(view.container.querySelector('form')?.dataset.mode).toBe('voice');
    click(view.container.querySelector('.cmp-send'));
    expect(start).toHaveBeenCalledWith('');
    view.unmount();
    view = mount(render(true));
    const send = view.container.querySelector('.cmp-send.is-rec') as HTMLElement;
    expect(send.getAttribute('aria-label')).toBe('Остановить диктовку');
    expect(send.getAttribute('aria-pressed')).toBe('true');
    click(send);
    expect(stop).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('диктовка: способа «Голосом» нет, если браузер не умеет; отказ показывает строку', () => {
    view = mount(
      <Composer label="Вопрос" placeholder="…" onSubmit={() => undefined} dictation={idle} />,
    );
    expect(view.container.querySelector('.cmp-mode')).toBeNull();
    view.unmount();
    view = mount(
      <Composer
        label="Вопрос"
        placeholder="…"
        onSubmit={() => undefined}
        dictation={{ ...idle, supported: true, denied: true }}
      />,
    );
    expect(view.container.querySelector('.cmp-toast')?.textContent).toBe('Нет доступа к микрофону');
  });
});
