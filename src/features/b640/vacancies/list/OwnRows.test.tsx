// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

let mobileScreen = false;
beforeEach(() => {
  mobileScreen = false;
  window.matchMedia = ((query: string) => ({
    matches: mobileScreen, media: query, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

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
  it('B676: без счёта раскрытие говорит почему и показывает найденное требование (Lever, регион)', async () => {
    const { getOwnVacancy } = await import('../ownVacancyApi');
    const gates = { role: { status: 'matched' }, level: { status: 'unknown' }, region: { status: 'blocked' }, workAuthorization: { status: 'unknown' }, workFormat: { status: 'unknown' } };
    vi.mocked(getOwnVacancy).mockResolvedValueOnce({
      ...item, coverage: null, text: 'Travel',
      fit: { state: 'ready', requirements: [{ id: 'r9', text: 'Готовность к командировкам по Европе', sourceQuote: 'x', origin: 'structural', importance: 'high', kind: 'other', hard: false, stopFactor: false, skill: false }],
        result: { status: 'blocked', reason: 'blocked_gate', gates, coverage: { matched: 0, total: 0, unknown: 0 }, assessments: [] } },
    } as never);
    const view = mount(<table><OwnRows items={[{ ...item, coverage: null }]} money={RUB} onRemove={vi.fn()} /></table>);
    expect(view.container.querySelector('.vt-fitc')!.textContent).toContain('—');
    click(view.container.querySelector('.vt-toggle'));
    await vi.waitFor(() => expect(view.container.querySelector('.v4-one')).not.toBeNull());
    expect(view.container.textContent).toContain('Регион вакансии не входит в ваши условия поиска');
    expect(view.container.textContent).toContain('Готовность к командировкам по Европе');
    expect(view.container.querySelector('.v4-reqs-box .v4-reqs-open .v4-fd-l li')?.textContent).toBe('Готовность к командировкам по Европе');
    view.unmount();
  });
  it('B676: мало навыков для счёта — словами, а не пустое раскрытие', async () => {
    const { getOwnVacancy } = await import('../ownVacancyApi');
    const matched = { status: 'unknown' };
    const gates = { role: matched, level: matched, region: matched, workAuthorization: matched, workFormat: matched };
    vi.mocked(getOwnVacancy).mockResolvedValueOnce({
      ...item, coverage: null, text: 'x',
      fit: { state: 'ready', requirements: [], result: { status: 'unknown', reason: 'too_few_skills', gates, coverage: { matched: 0, total: 0, unknown: 0 }, assessments: [] } },
    } as never);
    const view = mount(<table><OwnRows items={[{ ...item, coverage: null }]} money={RUB} onRemove={vi.fn()} /></table>);
    click(view.container.querySelector('.vt-toggle'));
    await vi.waitFor(() => expect(view.container.querySelector('.v4-one')).not.toBeNull());
    expect(view.container.textContent).toContain('Мало требований для расчёта');
    expect(view.container.querySelector('.v4-reqs-box')).toBeNull();
    view.unmount();
  });
  it('раскрытие: «не оценка рынка», требования и ссылка на сайт', async () => {
    const view = mount(<table><OwnRows items={[item]} money={RUB} onRemove={vi.fn()} /></table>);
    click(view.container.querySelector('.vt-toggle'));
    await vi.waitFor(() => expect(view.container.querySelector('.v4-one')).not.toBeNull());
    expect(view.container.querySelector('.v4-one')!.textContent).toBe('Сравнение с одной вакансией — не оценка рынка');
    expect(view.container.textContent).toContain('Требования: 3 из 5 есть в профиле');
    expect(view.container.querySelector('a.vs-open')!.getAttribute('href')).toBe('https://ritm.example/jobs/1');
    expect(view.container.querySelector('a.vs-open')!.getAttribute('aria-label')).toBe('Открыть на сайте');
    view.unmount();
  });
  it('B676: на 390 удалить — через «…» → «Удалить», корзины в строке нет', () => {
    mobileScreen = true;
    const onRemove = vi.fn();
    const view = mount(<table><OwnRows items={[item]} money={RUB} onRemove={onRemove} /></table>);
    const more = view.container.querySelector<HTMLButtonElement>('.va-more');
    expect(more?.getAttribute('aria-label')).toBe('Ещё действия');
    click(more!);
    const dialog = view.container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe(`Действия: ${item.title}`);
    click(dialog!.querySelector<HTMLButtonElement>('.va-mi')!);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
  });
});
