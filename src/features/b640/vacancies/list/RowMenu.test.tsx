// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, mount, press, type Mounted } from '../../kit/testDom';
import { makeItem } from './fixtures';
import { RowMenu, type MenuView, type RowMenuActions } from './RowMenu';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: vi.fn() }),
}));

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function open(view: MenuView, actions: Partial<RowMenuActions> = {}, onClose = vi.fn()) {
  const full: RowMenuActions = {
    want: vi.fn(async () => undefined),
    hide: vi.fn(async () => undefined),
    applied: vi.fn(async () => undefined),
    ...actions,
  };
  mounted = mount(<RowMenu item={makeItem({ id: 'v1' })} initialView={view} actions={full} onClose={onClose} />);
  return { actions: full, onClose, root: mounted.container };
}

const flush = () => act(async () => undefined);

describe('меню строки', () => {
  it('вид «list»: пункты макета без лишнего', () => {
    const { root } = open('list');
    const dialog = root.querySelector('.va-pop.va-m')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    const text = dialog.textContent ?? '';
    for (const label of ['Хочу в компанию', 'Уже откликнулись', 'Не подходит', 'Открыть на сайте работодателя', 'Скопировать ссылку', 'Подготовить письмо']) {
      expect(text).toContain(label);
    }
    expect(text).not.toContain('Назначили интервью');
    const external = dialog.querySelector('a[target="_blank"]');
    expect(external?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('Esc закрывает окно', () => {
    const { onClose } = open('list');
    press(document, 'Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('«Не подходит»: причины радиокнопками, «Скрыть» передаёт выбранную', async () => {
    const { root, actions } = open('hide');
    expect(root.querySelectorAll('input[type="radio"]')).toHaveLength(5);
    click(root.querySelectorAll('input[type="radio"]')[2] ?? null);
    click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Скрыть') ?? null);
    await flush();
    expect(actions.hide).toHaveBeenCalledWith('comp-below');
  });

  it('«Уже откликнулись»: неверная дата — «Нет такой даты», действие не вызвано', async () => {
    const { root, actions } = open('applied');
    const input = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '31.13');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Сохранить') ?? null);
    expect(root.querySelector('.va-m-err')?.textContent).toContain('Нет такой даты');
    expect(actions.applied).not.toHaveBeenCalled();
  });

  it('верная дата уходит в действие', async () => {
    const { root, actions } = open('applied');
    const input = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '05.11');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Сохранить') ?? null);
    await flush();
    expect(actions.applied).toHaveBeenCalledTimes(1);
  });

  it('ошибка действия — строкой в окне с «Повторить», окно не закрыто', async () => {
    const hide = vi.fn().mockRejectedValueOnce(new Error('Сервер не ответил')).mockResolvedValue(undefined);
    const { root, onClose } = open('hide', { hide });
    click(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Скрыть') ?? null);
    await flush();
    expect(root.querySelector('.va-m-err')?.textContent).toContain('Сервер не ответил');
    expect(onClose).not.toHaveBeenCalled();
    click(Array.from(root.querySelectorAll('.va-m-err button'))[0] ?? null);
    await flush();
    expect(hide).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.va-m-err')).toBeNull();
  });
});

describe('B726: меню строки без компании из Telegram', () => {
  it('ссылка названа постом Telegram, а не сайтом работодателя', () => {
    const base = makeItem({ id: 'cluster-tg-it_vakansii_udalenka-2838', company: '' });
    const item = {
      ...base,
      cluster: { ...base.cluster, primaryUrl: 'https://t.me/it_vakansii_udalenka/2838' },
    };
    const actions: RowMenuActions = {
      want: vi.fn(async () => undefined),
      hide: vi.fn(async () => undefined),
      applied: vi.fn(async () => undefined),
    };
    mounted = mount(<RowMenu item={item} initialView="list" actions={actions} onClose={vi.fn()} />);
    const link = [...mounted.container.querySelectorAll('a')].find((a) => a.href.startsWith('https://t.me/'));
    expect(link?.textContent).toBe('Открыть пост в Telegram');
    expect(mounted.container.textContent).not.toContain('Открыть на сайте работодателя');
  });
});
