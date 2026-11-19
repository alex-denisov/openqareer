import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem } from '../testHelpers/b640VacancyHarness';
import { forgetMatchedListsForTests } from './matchedVacancyList';

const BASE = '/api/v1/candidate/b640/companies';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  forgetMatchedListsForTests();
  for (const close of closers.splice(0)) await close();
});

function otherRole(id: string, company: string) {
  const item = poolItem({ id, title: `Бухгалтер ${id}`, company });
  return { ...item, explanation: { ...item.explanation, roleMatch: 'none' } } as typeof item;
}

async function setup() {
  const harness = await createB640Harness({
    pool: () => [
      poolItem({ id: 'c-1', title: 'Инженер данных', company: 'Ромашка', location: 'Москва' }),
      poolItem({
        id: 'c-2',
        title: 'Старший инженер данных',
        company: 'Ромашка',
        location: 'Москва',
      }),
      otherRole('c-3', 'Ромашка'),
      poolItem({ id: 'c-4', title: 'Инженер данных', company: 'Лютик', location: 'Казань' }),
    ],
  });
  closers.push(harness.close);
  return harness;
}

describe('B677: GET b640/companies', () => {
  it('список с городами и счётчиком релокации; без флага — 404', async () => {
    const h = await setup();
    const response = await h.get(BASE, 'flagged.test');
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.items.map((item: { name: string }) => item.name).sort()).toEqual([
      'Лютик',
      'Ромашка',
    ]);
    expect(data.filterCounts.relocation).toBe(0);
    expect(data.relocation).toBe(false);
    expect((await h.get(`${BASE}?relocation=1`, 'flagged.test')).json().data.total).toBe(0);
    expect((await h.get(BASE, 'plain.test')).statusCode).toBe(404);
    expect((await h.get(`${BASE}?relocation=yes`, 'flagged.test')).statusCode).toBe(400);
  });
});

describe('B677: GET b640/companies/:id', () => {
  it('карточка по ключу названия: вакансии по ролям отдельно от остальных, статус отклика', async () => {
    const h = await setup();
    const response = await h.get(`${BASE}/${encodeURIComponent('ромашка')}`, 'flagged.test');
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.company.name).toBe('Ромашка');
    expect(data.roleTotal).toBe(2);
    expect(
      data.roleVacancies.map((item: { cluster: { id: string } }) => item.cluster.id).sort(),
    ).toEqual(['c-1', 'c-2']);
    expect(data.otherTotal).toBe(0); // пул подборки уже без вакансий вне ролей
    expect(data.applications).toEqual({});
    expect(data.roleNextOffset).toBeNull();
  });
  it('порции по limit и 404 для компании вне подборки', async () => {
    const h = await setup();
    const first = (
      await h.get(`${BASE}/${encodeURIComponent('ромашка')}?limit=1`, 'flagged.test')
    ).json().data;
    expect(first.roleVacancies).toHaveLength(1);
    expect(first.roleNextOffset).toBe(1);
    const missing = await h.get(`${BASE}/${'f'.repeat(24)}`, 'flagged.test');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('company_not_in_selection');
  });
  it('люди компании: без сети и рекрутеров пусто, без флага — 404', async () => {
    const h = await setup();
    const response = await h.get(`${BASE}/${encodeURIComponent('ромашка')}/people`, 'flagged.test');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      items: [],
      total: 0,
      offset: 0,
      nextOffset: null,
    });
    expect(
      (await h.get(`${BASE}/${encodeURIComponent('ромашка')}/people`, 'plain.test')).statusCode,
    ).toBe(404);
  });
});
