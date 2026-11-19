// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CandidateConnectionContact,
  CandidateConnectionContactsPage,
} from '../../../outreach/connectionContactsApi';
import { click, mount } from '../../kit/testDom';
import { ContactsScreen } from './ContactsScreen';

vi.mock('../../../outreach/connectionContactsApi', () => ({ listCandidateConnectionContacts: vi.fn() }));

const api = await import('../../../outreach/connectionContactsApi');
const list = vi.mocked(api.listCandidateConnectionContacts);

function contact(index: number, patch: Partial<CandidateConnectionContact> = {}): CandidateConnectionContact {
  return {
    id: `c${index}`, fullName: `Человек ${index}`, companyName: 'Гринкод', roleTitle: 'CTO',
    relationship: 'знакомы через Игоря Шаталова', strength: 'weak', linkedinUrl: null, workplaces: [],
    knowsRecruiterIds: [], source: 'linkedin_import', createdAt: '', updatedAt: '', ...patch,
  };
}

function page(items: CandidateConnectionContact[], total: number, nextOffset: number | null): CandidateConnectionContactsPage {
  return {
    items, total, offset: 0, limit: 100, nextOffset,
    linkedinImport: { state: 'imported', importedAt: '2026-11-10T09:00:00.000Z', importedCount: total },
  };
}

const many = (count: number) => Array.from({ length: count }, (_, index) => contact(index));
const flush = () => act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
const buttonByText = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((button) => button.textContent?.includes(text)) ?? null;

afterEach(() => vi.clearAllMocks());

describe('a02: контакты', () => {
  it('заголовок с числом, 20 строк и «Показать ещё»', async () => {
    list.mockResolvedValue(page(many(100), 1500, 100));
    const view = mount(<ContactsScreen />);
    await flush();
    expect(view.container.querySelector('#ct-title')!.textContent).toBe('1 500 контактов');
    expect(view.container.querySelectorAll('li.ct-row')).toHaveLength(20);
    expect(view.container.querySelector('.ct-count')!.textContent).toBe('20 из 1 500');
    expect(view.container.querySelector('li.ct-row .ct-w')!.textContent).toBe('CTO · Гринкод');
    expect(view.container.querySelector('li.ct-row .ct-p')!.textContent).toBe('знакомы через Игоря Шаталова');
    click(buttonByText(view.container, 'Показать ещё'));
    await flush();
    expect(view.container.querySelectorAll('li.ct-row')).toHaveLength(40);
    expect(list).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('за пределами загруженной сотни читает следующую порцию', async () => {
    list.mockResolvedValueOnce(page(many(20), 30, 20)).mockResolvedValueOnce(page(many(30), 30, null));
    const view = mount(<ContactsScreen />);
    await flush();
    click(buttonByText(view.container, 'Показать ещё'));
    await flush();
    expect(list).toHaveBeenLastCalledWith(20);
    expect(view.container.querySelectorAll('li.ct-row')).toHaveLength(30);
    view.unmount();
  });

  it('скрытое по данным не показывается: пустая связь без строки пути, нет поиска и фильтров', async () => {
    list.mockResolvedValue(page([contact(1, { relationship: ' ' })], 1, null));
    const view = mount(<ContactsScreen />);
    await flush();
    expect(view.container.querySelector('.ct-p')).toBeNull();
    expect(view.container.querySelector('input, select, .ct-tags, .vt-filters')).toBeNull();
    view.unmount();
  });

  it('связей нет — одна строка пустого состояния', async () => {
    list.mockResolvedValue(page([], 0, null));
    const view = mount(<ContactsScreen />);
    await flush();
    expect(view.container.querySelector('.vl-empty-t')!.textContent).toBe('Связей пока нет');
    expect(view.container.querySelector('.vl-empty button')).toBeNull();
    view.unmount();
  });

  it('ошибка загрузки — «Повторить» читает ещё раз', async () => {
    list.mockRejectedValueOnce(new Error('net')).mockResolvedValue(page(many(2), 2, null));
    const view = mount(<ContactsScreen />);
    await flush();
    expect(view.container.textContent).toContain('Контакты не загрузились');
    click(buttonByText(view.container, 'Повторить'));
    await flush();
    expect(view.container.querySelectorAll('li.ct-row')).toHaveLength(2);
    view.unmount();
  });
});
