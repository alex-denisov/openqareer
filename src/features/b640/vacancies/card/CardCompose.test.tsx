// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { B640CompanyPerson } from '../../../../../shared/b640Companies';
import { click, mount, type Mounted } from '../../kit/testDom';
import { makeItem } from '../list/fixtures';
import { CardScreen } from './CardScreen';

// jsdom без matchMedia: широкий экран (Fold и useIsMobile читают медиа-запрос).
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  onchange: null,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined, ctxSlot: null }),
  useScreenChrome: () => undefined,
}));
vi.mock('../../messages/contactMessageApi', () => ({
  createB640ContactMessage: vi.fn(() => new Promise(() => undefined)),
  editB640ContactMessage: vi.fn(),
  approveB640ContactMessage: vi.fn(),
  markB640ContactMessageSent: vi.fn(),
}));
vi.mock('./useVacancyFit', () => ({
  useVacancyFit: () => ({ view: undefined, failed: false, retry: () => undefined }),
}));
vi.mock('./useSave', () => ({
  useSave: () => ({ button: null, failed: false, retry: () => undefined }),
}));
vi.mock('./QuotaLine', () => ({ QuotaLine: () => null }));
vi.mock('./FitBlock', () => ({ FitBlock: () => null }));
vi.mock('./ReqsBox', () => ({ ReqsBox: () => null }));
vi.mock('./ActBar', () => ({ ActBar: () => null }));
vi.mock('./MoneyBlock', () => ({ MoneyBlock: () => null, useTargetCurrency: () => 'RUB' }));
vi.mock('./LetterBlock', () => ({ LetterBlock: () => null }));

const roman = (message: B640CompanyPerson['message']): B640CompanyPerson => ({
  id: 'p1',
  circle: 1,
  name: 'Роман Ефимов',
  roleTitle: 'руководитель группы платежей',
  evidence: 'работали вместе в «Сфере Платежи»',
  nextStep: 'write_known_contact',
  vacancyId: 'v1',
  platformMember: false,
  message,
});

let people: B640CompanyPerson[] = [];
vi.mock('./useCardData', () => ({
  useCardData: () => ({
    load: 'ready',
    item: makeItem({ id: 'v1', title: 'Руководитель разработки', company: 'Ладога Банк' }),
    links: {},
    people: { items: people, total: people.length, offset: 0, nextOffset: null },
    reload: () => undefined,
  }),
}));

const byText = (root: ParentNode, selector: string, text: string) =>
  [...root.querySelectorAll(selector)].find((node) => node.textContent?.includes(text)) ?? null;

let view: Mounted | undefined;
afterEach(() => view?.unmount());

function open(message: B640CompanyPerson['message']): HTMLElement {
  people = [roman(message)];
  view = mount(<CardScreen vacancyId="v1" />);
  return view.container;
}

describe('карточка вакансии: «Написать» открывает шаг «Отклик» (a02d)', () => {
  it('нажатие показывает заголовок «Написать Роману Ефимову» и панель черновика', () => {
    const root = open({ kind: 'known_contact', target: { contactId: 'c-p1' } });
    click(byText(root, 'button', 'Написать Роману'));
    expect(root.querySelector('h2.lead-title')?.textContent).toContain('Написать Роману Ефимову');
    expect(root.querySelector('.lk-inline')?.textContent).toContain('Черновик');
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Отклик');
    expect(byText(root, 'summary', 'О компании и люди')).not.toBeNull();
    expect(byText(root, 'h3', 'Кто нанимает в Ладога Банк')).not.toBeNull();
    expect(root.textContent).not.toContain('Как откликнуться');
  });

  it('«Не отправлять» возвращает обычную карточку', () => {
    const root = open({ kind: 'known_contact', target: { contactId: 'c-p1' } });
    click(byText(root, 'button', 'Написать Роману'));
    click(byText(root, 'button', 'Не отправлять'));
    expect(root.querySelector('.lk-inline')).toBeNull();
    expect(root.textContent).toContain('Как откликнуться');
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Вакансия');
  });

  it('без черновика у знакомого кнопки «Написать» нет', () => {
    const root = open(null);
    expect(root.textContent).toContain('Через знакомого — Роман Ефимов');
    expect(byText(root, 'button', 'Написать')).toBeNull();
  });

  it('имя в «Кто нанимает» — ссылка: переключает черновик на этого человека (макет: имя ведёт к письму)', () => {
    people = [
      roman({ kind: 'known_contact', target: { contactId: 'c-p1' } }),
      { ...roman({ kind: 'ask_introduction', target: { contactId: 'c-via' } }), id: 'p2', circle: 2, name: 'Ольга Ким' },
    ];
    view = mount(<CardScreen vacancyId="v1" />);
    const root = view.container;
    click(byText(root, 'button', 'Написать Роману'));
    const olga = byText(root, '.hire-row a.row-title', 'Ольга Ким');
    expect(olga).not.toBeNull();
    click(olga);
    expect(root.querySelector('h2.lead-title')?.textContent).toContain('Написать Ольге Ким');
    expect(root.querySelector('.lk-inline')?.textContent).toContain('Черновик');
  });
});
