// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from './testDom';
import { SettingsGroup, SettingsRow, Switch } from './Settings';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

describe('SettingsRow / Switch / SettingsGroup', () => {
  it('разметка макета: группа, строка, подписи, переключатель', () => {
    view = mount(
      <SettingsGroup title="Уведомления">
        <SettingsRow
          id="n1"
          title="Письма об откликах"
          value="m.sokolova@mail.ru"
          end={<Switch labelledBy="n1" checked onChange={() => undefined} />}
        />
      </SettingsGroup>,
    );
    const group = view.container.querySelector('section.set-group');
    expect(group?.querySelector('h3.set-h')?.textContent).toBe('Уведомления');
    const row = group?.querySelector('ul.set-list > li.set-row');
    expect(row?.querySelector('.set-l > .set-t#n1')?.textContent).toBe('Письма об откликах');
    expect(row?.querySelector('.set-l > .set-v')?.textContent).toBe('m.sokolova@mail.ru');
    const input = row?.querySelector('.set-r > span.sw-cell > input.sw') as HTMLInputElement;
    expect(input.type).toBe('checkbox');
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.getAttribute('aria-labelledby')).toBe('n1');
    expect(input.checked).toBe(true);
  });
  it('без значения и конца лишних узлов нет', () => {
    view = mount(<SettingsRow title="Почта" />);
    expect(view.container.querySelector('.set-v')).toBeNull();
    expect(view.container.querySelector('.set-r')).toBeNull();
  });
  it('переключатель сообщает новое состояние', () => {
    const onChange = vi.fn();
    view = mount(<Switch labelledBy="x" checked={false} onChange={onChange} />);
    click(view.container.querySelector('input'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
