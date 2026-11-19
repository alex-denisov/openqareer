// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { B640Contact, B640ContactList } from '../../../../../shared/b640Contacts';
import { click, mount } from '../../kit/testDom';
import { ContactsScreen } from './ContactsScreen';

vi.mock('./contactsApi', async (original) => ({
  ...(await original<typeof import('./contactsApi')>()),
  listB640Contacts: vi.fn(),
}));

const navigate = vi.fn();
vi.mock('../../shell/ShellContext', () => ({ useShell: () => ({ navigate }) }));

const api = await import('./contactsApi');
const list = vi.mocked(api.listB640Contacts);

function contact(index: number, patch: Partial<B640Contact> = {}): B640Contact {
  return {
    id: `c${index}`,
    fullName: `Человек ${index}`,
    roleTitle: 'CTO',
    companyName: 'Гринкод',
    link: 'intro',
    linkNote: 'знакомы через Игоря Шаталова',
    status: { state: 'none', at: null },
    inSelection: true,
    ...patch,
  };
}

function page(items: B640Contact[], total: number, nextOffset: number | null): B640ContactList {
  return {
    items,
    total,
    offset: 0,
    nextOffset,
    facets: {
      companies: [
        { name: 'Гринкод', count: 12 },
        { name: 'Арка', count: 3 },
      ],
      link: { direct: 1, intro: 2, none: 3 },
      status: { none: 5, written: 1, replied: 0 },
    },
    linkedinImport: {
      state: 'imported',
      importedAt: '2026-11-10T09:00:00.000Z',
      importedCount: total,
    },
  };
}

const many = (count: number) => Array.from({ length: count }, (_, index) => contact(index));
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const byText = (root: ParentNode, selector: string, text: string) =>
  [...root.querySelectorAll<HTMLElement>(selector)].find((node) =>
    node.textContent?.includes(text),
  ) ?? null;
const setValue = (input: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(() => {
    const proto =
      input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });

const screen = () => mount(<ContactsScreen />);

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('a02: контакты', () => {
  it('заголовок с числом, 20 строк, «Показать ещё» читает следующую порцию', async () => {
    list
      .mockResolvedValueOnce(page(many(20), 1500, 20))
      .mockResolvedValueOnce(page(many(40).slice(20), 1500, 40));
    const view = screen();
    await flush();
    expect(view.container.querySelector('#ct-title')!.textContent!.replace(/\u00a0/gu, ' ')).toBe(
      '1 500 человек, которые нанимают',
    );
    expect(view.container.querySelectorAll('li.ct-row')).toHaveLength(20);
    expect(view.container.querySelector('.ct-count')!.textContent!.replace(/\u00a0/gu, ' ')).toBe(
      '20 из 1 500',
    );
    expect(view.container.querySelector('li.ct-row .ct-w')!.textContent).toBe('CTO · Гринкод');
    expect(view.container.querySelector('li.ct-row .ct-p')!.textContent).toBe(
      'знакомы через Игоря Шаталова',
    );
    click(byText(view.container, 'button', 'Показать ещё'));
    await flush();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 }));
    expect(view.container.querySelectorAll('li.ct-row')).toHaveLength(40);
    view.unmount();
  });

  it('метки статуса: не писали, писали дд.мм, ответил', async () => {
    list.mockResolvedValue(
      page(
        [
          contact(1),
          contact(2, { status: { state: 'written', at: '2026-11-12T12:00:00.000Z' } }),
          contact(3, { status: { state: 'replied', at: 'x' } }),
        ],
        3,
        null,
      ),
    );
    const view = screen();
    await flush();
    const tags = [...view.container.querySelectorAll('.ct-tags .tag')];
    expect(view.container.querySelector('.ct-tags .icon-btn')).toBeNull();
    expect(tags.map((tag) => [tag.className, tag.textContent])).toEqual([
      ['tag', 'не писали'],
      ['tag part', 'писали 12.11'],
      ['tag ok', 'ответил'],
    ]);
    view.unmount();
  });

  it('поиск уходит в запрос через 300 мс', async () => {
    list.mockResolvedValue(page(many(2), 2, null));
    const view = screen();
    await flush();
    list.mockClear();
    setValue(view.container.querySelector<HTMLInputElement>('#ct-q')!, 'Ким');
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(list).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: 'Ким', offset: 0 }));
    view.unmount();
  });

  it('фильтр «Компания»: выбор даёт чип и запрос, «Сбросить всё» снимает', async () => {
    list.mockResolvedValue(page(many(2), 2, null));
    const view = screen();
    await flush();
    click(byText(view.container, '.vt-fbtn', 'Компания'));
    expect(view.container.querySelector('#pop-company')!.textContent).toContain('Гринкод');
    expect(view.container.querySelector('#pop-company .vt-opt-n')!.textContent).toBe('12');
    click(byText(view.container, '#pop-company .vt-opt', 'Гринкод')!.querySelector('input'));
    await flush();
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: { company: ['Гринкод'], link: [], status: [] } }),
    );
    expect(view.container.querySelector('.vt-chip')!.textContent).toBe('Гринкод');
    click(byText(view.container, '.vt-reset', 'Сбросить всё'));
    await flush();
    expect(view.container.querySelector('.vt-chip')).toBeNull();
    view.unmount();
  });

  it('сортировка уходит в запрос', async () => {
    list.mockResolvedValue(page(many(2), 2, null));
    const view = screen();
    await flush();
    setValue(view.container.querySelector<HTMLSelectElement>('#ct-sort')!, 'Сначала: по имени');
    await flush();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'name' }));
    view.unmount();
  });

  it('пустая строка пути не выводится', async () => {
    list.mockResolvedValue(page([contact(1, { linkNote: null })], 1, null));
    const view = screen();
    await flush();
    expect(view.container.querySelector('.ct-p')).toBeNull();
    view.unmount();
  });

  it('связей нет — одна строка пустого состояния без панели', async () => {
    list.mockResolvedValue(page([], 0, null));
    const view = screen();
    await flush();
    expect(view.container.querySelector('.vl-empty-t')!.textContent).toBe('Связей пока нет');
    expect(view.container.querySelector('input, .vt-filters')).toBeNull();
    click(byText(view.container, 'button', 'Обновить из LinkedIn'));
    expect(navigate).toHaveBeenCalledWith('/app/profile/linkedin');
    view.unmount();
  });

  it('по фильтру никого — «Никого не нашли» и сброс', async () => {
    list
      .mockResolvedValueOnce(page(many(2), 2, null))
      .mockResolvedValueOnce(page([], 0, null))
      .mockResolvedValue(page(many(2), 2, null));
    const view = screen();
    await flush();
    click(byText(view.container, '.vt-fbtn', 'Статус'));
    click(byText(view.container, '#pop-status .vt-opt', 'Ответили')!.querySelector('input'));
    await flush();
    expect(view.container.querySelector('.vl-empty-t')!.textContent).toBe('Никого не нашли');
    click(byText(view.container, '.vl-empty button', 'Сбросить всё'));
    await flush();
    expect(view.container.querySelectorAll('li.ct-row')).toHaveLength(2);
    view.unmount();
  });

  it('ошибка загрузки — «Повторить» читает ещё раз', async () => {
    list.mockRejectedValueOnce(new Error('net')).mockResolvedValue(page(many(2), 2, null));
    const view = screen();
    await flush();
    expect(view.container.textContent).toContain('Контакты не загрузились');
    click(byText(view.container, 'button', 'Повторить'));
    await flush();
    expect(view.container.querySelectorAll('li.ct-row')).toHaveLength(2);
    view.unmount();
  });

  it('390: кнопка «Фильтры» открывает лист с сортировкой и фильтрами', async () => {
    list.mockResolvedValue(page(many(2), 2, null));
    const view = screen();
    await flush();
    click(view.container.querySelector('.vt-mfilter'));
    const sheet = view.container.querySelector('#ct-sheet')!;
    expect(sheet.textContent).toContain('Сортировка');
    expect(sheet.textContent).toContain('Связь');
    expect(sheet.textContent).toContain('Статус');
    view.unmount();
  });
  it('имя — ссылка на карточку компании; без компании — обычный текст', async () => {
    list.mockResolvedValueOnce(
      page([contact(1, { companyName: 'Грин-Код' }), contact(2, { companyName: '' })], 2, null),
    );
    const view = screen();
    await flush();
    const names = view.container.querySelectorAll<HTMLElement>('.ct-n');
    expect(names[0]!.tagName).toBe('A');
    expect(names[0]!.getAttribute('href')).toBe(
      `/app/vacancies/companies/${encodeURIComponent('гринкод')}`,
    );
    expect(names[1]!.tagName).toBe('DIV');
  });
});
