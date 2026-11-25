// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../kit/testDom';
import { VacancyText } from './VacancyText';
import { sourceLinkOf } from './waysModel';

const detail = vi.hoisted(() => ({ state: {} as unknown }));
vi.mock('../../../vacancies/vacancyDetailApi', () => ({ useVacancyDetail: () => detail.state }));

let view: Mounted | undefined;
afterEach(() => view?.unmount());

const source = { url: 'https://hh.ru/vacancy/1', label: 'Открыть на hh.ru' };
const show = (state: unknown): HTMLElement => {
  view?.unmount();
  detail.state = state;
  view = mount(<VacancyText clusterId="c" fit={undefined} source={source} />);
  return view.container;
};
const ready = (extra: object) => ({ status: 'ready', detail: { description: '', ...extra } });

describe('VacancyText (B800)', () => {
  it('текст читается — скелет, и пока сервер дочитывает тоже', () => {
    expect(show({ status: 'loading' }).querySelector('.is-skel')).not.toBeNull();
    expect(show(ready({ pending: true })).querySelector('.is-skel')).not.toBeNull();
  });

  it('текста нет или он скрыт — блока нет, ссылка на источник есть', () => {
    for (const extra of [{}, { textHidden: true, brief: { duties: ['a'] } }]) {
      const root = show(ready(extra));
      expect(root.querySelector('.vt-txt')).toBeNull();
      expect(root.querySelector('a')?.getAttribute('href')).toBe(source.url);
    }
  });

  it('разделы по порядку, пустого раздела нет', () => {
    const brief = { duties: ['Вести'], requirements: [], conditions: ['ДМС'], opening: '' };
    expect(show(ready({ brief })).textContent).toBe('ЗадачиВестиУсловияДМС');
  });

  it('разделов нет — текст абзацами; сбой — «Повторить»', () => {
    const brief = { duties: [], requirements: [], conditions: [], opening: 'О.' };
    const root = show(ready({ brief, description: 'Первый.\n\nВторой.' }));
    expect([...root.querySelectorAll('p')].map((node) => node.textContent)).toEqual([
      'Первый.',
      'Второй.',
    ]);
    expect(show({ status: 'failed' }).querySelector('button')?.textContent).toBe('Повторить');
  });

  it('ссылка на площадку не повторяет «Как откликнуться»', () => {
    const input = { primaryUrl: 'https://hh.ru/vacancy/1' };
    expect(sourceLinkOf(input, [])).toEqual(source);
    const site = {
      id: 'site',
      title: 'Сайт',
      icon: 'out',
      action: { kind: 'external', label: 'Открыть', url: 'https://a.io' },
    } as const;
    expect(sourceLinkOf(input, [site])).toBeUndefined();
  });
});
