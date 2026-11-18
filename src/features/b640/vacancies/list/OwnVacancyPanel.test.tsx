// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, mount, press } from '../../kit/testDom';
import { OwnAddButton, OwnVacancyPanel } from './OwnVacancyPanel';
import type { OwnAddStatus } from './useOwnVacancies';

interface Handlers {
  readonly onAdd?: (value: string) => Promise<boolean>;
  readonly onClose?: () => void;
  readonly onEdit?: () => void;
}

function panel(status: OwnAddStatus, handlers: Handlers = {}) {
  return mount(
    <OwnVacancyPanel status={status} onAdd={handlers.onAdd ?? (async () => true)} onClose={handlers.onClose ?? (() => undefined)} onEdit={handlers.onEdit ?? (() => undefined)} />,
  );
}
const buttons = (root: Element) => [...root.querySelectorAll('.va-add-st button')].map((button) => button.textContent);

describe('«Своя вакансия»: кнопка и панель', () => {
  it('кнопка: полная и короткая подписи, aria-expanded', () => {
    const view = mount(<OwnAddButton open onClick={vi.fn()} />);
    const button = view.container.querySelector('.va-addbtn')!;
    expect(button.querySelector('.vl-lg')!.textContent).toBe('Проверить свою вакансию');
    expect(button.querySelector('.vl-sm')!.textContent).toBe('Своя вакансия');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    view.unmount();
  });
  it('чтение: статус в блоке, «Добавить» неактивна', () => {
    const view = panel({ kind: 'reading' });
    expect(view.container.querySelector('#va-add-st')!.textContent).toBe('Читаем вакансию…');
    expect(view.container.querySelector('.va-add-foot .btn')!.getAttribute('aria-disabled')).toBe('true');
    view.unmount();
  });
  it('страница не открылась: «Повторить» и «Вставить текст»; закрытый сайт и пустая страница — только «Вставить текст»', () => {
    const failed = panel({ kind: 'unreadable', reason: 'failed' });
    expect(failed.container.querySelector('.va-add-st.is-err span')!.textContent).toBe('Страница не открылась');
    expect(buttons(failed.container)).toEqual(['Повторить', 'Вставить текст']);
    expect(failed.container.querySelector('textarea')!.getAttribute('aria-invalid')).toBe('true');
    failed.unmount();
    for (const reason of ['site_closed', 'thin'] as const) {
      const view = panel({ kind: 'unreadable', reason });
      expect(buttons(view.container)).toEqual(['Вставить текст']);
      view.unmount();
    }
  });
  it('«Вставить текст» сбрасывает ошибку; Esc и крестик закрывают', () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    const view = panel({ kind: 'unreadable', reason: 'thin' }, { onEdit, onClose });
    click(view.container.querySelector('.va-add-st button'));
    expect(onEdit).toHaveBeenCalled();
    press(document, 'Escape');
    click(view.container.querySelector('.va-add-h .icon-btn'));
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
