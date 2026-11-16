// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, press, type Mounted } from './testDom';
import { Dialog } from './Dialog';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function Harness({ onClose }: { readonly onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main id="outside">
        <button id="opener" type="button" onClick={() => setOpen(true)}>
          Открыть
        </button>
      </main>
      <Dialog
        open={open}
        title="Какими резюме откликаться"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        footer={
          <button id="last" type="button">
            Продолжить
          </button>
        }
      >
        <input id="first" aria-label="Имя" />
      </Dialog>
    </>
  );
}

function open(onClose?: () => void): Mounted {
  const v = mount(<Harness onClose={onClose} />);
  const opener = v.container.querySelector('#opener') as HTMLButtonElement;
  act(() => opener.focus());
  click(opener);
  return v;
}

describe('Dialog', () => {
  it('закрыто — ничего нет', () => {
    view = mount(<Harness />);
    expect(view.container.querySelector('.pf-dialog')).toBeNull();
  });
  it('разметка макета', () => {
    view = open();
    const dialog = view.container.querySelector('.pf-dialog') as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = dialog.querySelector('.pf-dh h2') as HTMLElement;
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(dialog.querySelector('span.grab')).not.toBeNull();
    expect(dialog.querySelector('.pf-dh button.icon-btn')?.getAttribute('aria-label')).toBe(
      'Закрыть',
    );
    expect(dialog.querySelector('.pf-db #first')).not.toBeNull();
    expect(dialog.querySelector('.pf-df #last')).not.toBeNull();
    expect(view.container.querySelector('.pf-back')?.getAttribute('aria-hidden')).toBe('true');
  });
  it('фокус внутрь, остальное inert, возврат фокуса при закрытии', () => {
    view = open();
    const dialog = view.container.querySelector('.pf-dialog') as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(view.container.querySelector('#outside')?.hasAttribute('inert')).toBe(true);
    press(dialog, 'Escape');
    expect(view.container.querySelector('#outside')?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement?.id).toBe('opener');
  });
  it('Tab не выходит из окна', () => {
    view = open();
    const dialog = view.container.querySelector('.pf-dialog') as HTMLElement;
    act(() => (view?.container.querySelector('#last') as HTMLElement).focus());
    press(dialog, 'Tab');
    expect(document.activeElement).toBe(dialog.querySelector('.pf-dh button'));
    press(dialog, 'Tab', { shiftKey: true });
    expect(document.activeElement?.id).toBe('last');
  });
  it('нажатие на фон закрывает', () => {
    const onClose = vi.fn();
    view = open(onClose);
    click(view.container.querySelector('.pf-back'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('.pf-dialog')).toBeNull();
  });
});
