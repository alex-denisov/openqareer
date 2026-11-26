// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../../kit/testDom';

vi.mock('../../shell/Link', () => ({
  Link: ({ to, children, ...rest }: { readonly to: string; readonly children: unknown }) => (
    <a href={to} {...rest}>
      {children as never}
    </a>
  ),
}));

const { HhNotConnected } = await import('./HhNotConnected');

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const connect = () => view?.container.querySelector('a[aria-label="Подключить hh.ru"]');
const box = () => view?.container.querySelector<HTMLInputElement>('.check.src-imp input') ?? null;

describe('a11b: hh.ru не подключён', () => {
  it('флажок импорта отмечен, подключение ведёт в n03 с импортом', () => {
    view = mount(<HhNotConnected />);
    expect(view.container.querySelector('.check.src-imp label')?.textContent).toBe(
      'Импортировать данные из резюме',
    );
    expect(box()?.checked).toBe(true);
    expect(connect()?.getAttribute('href')).toBe('/app/account/connections?import=1');
  });

  it('снятый флажок — n03 только подключает', () => {
    view = mount(<HhNotConnected />);
    click(box());
    expect(box()?.checked).toBe(false);
    expect(connect()?.getAttribute('href')).toBe('/app/account/connections?import=0');
  });
});
