// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from './testDom';
import { ActionDock } from './ActionDock';
import { Button } from './Button';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

describe('ActionDock', () => {
  it('закреплённая полоса: одна главная и одна второстепенная кнопка', () => {
    view = mount(
      <ActionDock
        primary={<Button variant="primary">Принять 4</Button>}
        secondary={<Button>Позже</Button>}
      />,
    );
    const dock = view.container.querySelector('div.act-dock.only-mob');
    expect(dock?.querySelectorAll('.btn.is-primary')).toHaveLength(1);
    expect(dock?.querySelectorAll('.btn:not(.is-primary)')).toHaveLength(1);
  });
  it('полоса формы: div.actions.m-commit', () => {
    view = mount(
      <ActionDock kind="commit" primary={<Button variant="primary">Сохранить итог</Button>} />,
    );
    expect(view.container.querySelector('div.actions.m-commit .is-primary')).not.toBeNull();
  });
  it('высота полосы уходит в --career-m-commit-h корня', () => {
    view = mount(
      <ActionDock kind="commit" primary={<Button variant="primary">Сохранить</Button>} />,
    );
    expect(view.container.style.getPropertyValue('--career-m-commit-h')).toMatch(/^\d+px$/);
  });
  it('после размонтирования переменная снята', () => {
    const v = mount(
      <ActionDock kind="commit" primary={<Button variant="primary">Сохранить</Button>} />,
    );
    const root = v.container;
    v.unmount();
    expect(root.style.getPropertyValue('--career-m-commit-h')).toBe('');
  });
});
