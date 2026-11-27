// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, mount } from '../../kit/testDom';
import { getOwnVacancy } from '../ownVacancyApi';
import { OwnCardScreen } from './OwnCardScreen';

vi.mock('../ownVacancyApi', () => ({ getOwnVacancy: vi.fn() }));

const detail = {
  id: 'own-1',
  title: 'Руководитель группы бэкенда',
  company: 'Ритм Ритейл',
  location: 'Москва',
  workFormat: 'office',
  url: 'https://ritm.example/jobs/1',
  createdAt: '2026-11-18T10:00:00.000Z',
  coverage: { matched: 1, total: 1 },
  comparing: false,
  text: 'О нас',
  fit: {
    state: 'ready',
    requirements: [
      {
        id: 'r1',
        text: 'Go',
        sourceQuote: 'Go',
        origin: 'explicit',
        importance: 'high',
        kind: 'other',
        hard: false,
        stopFactor: false,
      },
    ],
    result: {
      status: 'assessed',
      gates: {},
      coverage: { matched: 1, total: 1, unknown: 0 },
      assessments: [{ requirementId: 'r1', status: 'matched', evidence: [] }],
    },
  },
};

describe('v04c: карточка своей вакансии', () => {
  it('шапка, «не оценка рынка», свёрнутые требования и текст в окне', async () => {
    vi.mocked(getOwnVacancy).mockResolvedValue(detail as never);
    window.matchMedia = (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as never;
    const view = mount(
      <div className="b640">
        <OwnCardScreen vacancyId="own-1" />
      </div>,
    );
    await vi.waitFor(() => expect(view.container.querySelector('#vc-title')).not.toBeNull());
    expect(view.container.querySelector('.v4-coname')!.textContent).toBe('Ритм Ритейл');
    expect(view.container.querySelector('.v4-co-sub')!.textContent).toBe('Москва · офис');
    expect(view.container.querySelector('.v4-one')!.textContent).toBe(
      'Сравнение с одной вакансией — не оценка рынка',
    );
    const row = view.container.querySelector('button.v4-req-row')!;
    expect(row.textContent).toBe('Требования: 1 из 1 есть в профиле');
    expect(view.container.querySelector('.v4-reqs-open')).toBeNull();
    click(row);
    expect(view.container.querySelector('.v4-reqs-open')).not.toBeNull();
    expect(view.container.querySelector('a.is-primary')!.getAttribute('href')).toBe(detail.url);
    click(view.container.querySelector('button.v4-text'));
    expect(view.container.querySelector('[role="dialog"]')!.textContent).toContain('О нас');
    view.unmount();
  });

  it('не открылась — «Повторить»', async () => {
    vi.mocked(getOwnVacancy).mockRejectedValue(new Error('x'));
    const view = mount(<OwnCardScreen vacancyId="own-1" />);
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('Не удалось открыть вакансию'),
    );
    expect(view.container.textContent).toContain('Повторить');
    view.unmount();
  });
});
