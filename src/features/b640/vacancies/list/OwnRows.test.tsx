// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { click, mount } from '../../kit/testDom';
import { OwnRows } from './OwnRows';

vi.mock('../ownVacancyApi', () => ({
  getOwnVacancy: vi.fn(async () => ({
    id: 'own-1', title: 'Руководитель группы бэкенда', company: 'Ритм Ритейл', location: 'Москва', workFormat: 'office', url: 'https://ritm.example/jobs/1',
    createdAt: '2026-11-18T10:00:00.000Z', coverage: { matched: 3, total: 5 }, comparing: false, text: 'О нас\n\nТребования:\n- Go',
    fit: { state: 'ready', requirements: [{ id: 'r1', text: 'Go', sourceQuote: 'Go', origin: 'explicit', importance: 'high', kind: 'other', hard: false, stopFactor: false }],
      result: { coverage: { matched: 3, total: 5, unknown: 0 }, assessments: [{ requirementId: 'r1', status: 'matched', evidence: [] }] } },
  })),
}));

const item = {
  id: 'own-1', title: 'Руководитель группы бэкенда', company: 'Ритм Ритейл', location: 'Москва', workFormat: 'office' as const,
  url: 'https://ritm.example/jobs/1', createdAt: '2026-11-18T10:00:00.000Z', coverage: { matched: 3, total: 5 }, comparing: false,
};

const RUB = { currency: 'RUB' as const, rates: { date: '2026-11-23', rubPerUnit: { USD: 90, EUR: 98 } } };

describe('свои вакансии в таблице', () => {
  it('B676: деньги — по правилам списка: в месяц, в валюте списка; без суммы — «не указана»', () => {
    const yearly = { ...item, salary: { from: 114_000, to: 130_000, currency: 'USD', period: 'year' as const } };
    const rouble = { ...item, id: 'own-2', salary: { from: 450_000, currency: 'RUB' } };
    const view = mount(<table><OwnRows items={[yearly, rouble, { ...item, id: 'own-3' }]} money={RUB} onRemove={vi.fn()} /></table>);
    const cells = [...view.container.querySelectorAll('.vt-money')].map((cell) => cell.textContent);
    expect(cells[0]).toBe('≈ 855–975 тыс. ₽');
    expect(cells[1]).toBe('от 450 тыс. ₽');
    expect(cells[2]).toBe('не указана');
    view.unmount();
  });
  it('строка с меткой «ваша» и «3 из 5» без процента', () => {
    const view = mount(<table><OwnRows items={[item]} money={RUB} onRemove={vi.fn()} /></table>);
    const row = view.container.querySelector('tr.vt-row')!;
    expect(row.querySelector('.va-mine')!.textContent).toContain('ваша');
    expect(row.querySelector('.vt-fitc')!.textContent).toContain('3 из 5');
    expect(row.querySelector('.vt-fitc')!.textContent).not.toContain('%');
    view.unmount();
  });
  it('пока сравнение идёт — «считаем»; удаление по кнопке', () => {
    const onRemove = vi.fn();
    const view = mount(<table><OwnRows items={[{ ...item, coverage: null, comparing: true }]} money={RUB} onRemove={onRemove} /></table>);
    expect(view.container.querySelector('.vt-counting')!.textContent).toContain('считаем');
    click(view.container.querySelector('.va-no'));
    expect(onRemove).toHaveBeenCalledWith('own-1');
    view.unmount();
  });
  it('B676: правила не нашли требований — так и сказано в раскрытии', async () => {
    const { getOwnVacancy } = await import('../ownVacancyApi');
    vi.mocked(getOwnVacancy).mockResolvedValueOnce({
      ...item, coverage: null, text: 'About the role', fit: { state: 'no_requirements', requirements: [] },
    } as never);
    const view = mount(<table><OwnRows items={[item]} money={RUB} onRemove={vi.fn()} /></table>);
    click(view.container.querySelector('.vt-toggle'));
    await vi.waitFor(() => expect(view.container.querySelector('.v4-one')).not.toBeNull());
    expect(view.container.textContent).toContain('Требования в тексте не нашлись');
    view.unmount();
  });
  it('раскрытие: «не оценка рынка», требования и ссылка на сайт', async () => {
    const view = mount(<table><OwnRows items={[item]} money={RUB} onRemove={vi.fn()} /></table>);
    click(view.container.querySelector('.vt-toggle'));
    await vi.waitFor(() => expect(view.container.querySelector('.v4-one')).not.toBeNull());
    expect(view.container.querySelector('.v4-one')!.textContent).toBe('Сравнение с одной вакансией — не оценка рынка');
    expect(view.container.textContent).toContain('Требования: 3 из 5 есть в профиле');
    expect(view.container.querySelector('a.vs-open')!.getAttribute('href')).toBe('https://ritm.example/jobs/1');
    view.unmount();
  });
});
