// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from './testDom';
import { SegControl } from './SegControl';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

describe('SegControl', () => {
  it('группа переключателей макета, выбранный отмечен', () => {
    const onChange = vi.fn();
    view = mount(
      <SegControl
        label="Тема"
        name="t"
        value="dark"
        options={[
          { value: 'light', label: 'Светлая' },
          { value: 'dark', label: 'Тёмная' },
        ]}
        onChange={onChange}
      />,
    );
    const group = view.container.querySelector('div.seg-ctl[role=radiogroup]');
    expect(group?.getAttribute('aria-label')).toBe('Тема');
    const inputs = group?.querySelectorAll(
      'label > input[type=radio]',
    ) as NodeListOf<HTMLInputElement>;
    expect(Array.from(inputs).map((i) => i.checked)).toEqual([false, true]);
    click(inputs[0]);
    expect(onChange).toHaveBeenCalledWith('light');
  });
});
