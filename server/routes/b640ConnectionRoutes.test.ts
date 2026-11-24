import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/connections';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup() {
  const pool = () => [poolItem({ id: 'c1', title: 'Инженер данных', company: 'Ромашка' })];
  const h = await createB640Harness({ pool });
  closers.push(h.close);
  const seed = (id: string, fullName: string, companyName: string, user: HarnessUser) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/candidate/connection-contacts/${id}`,
      payload: {
        fullName,
        companyName,
        roleTitle: 'инженер',
        relationship: 'Коллега',
        strength: 'strong',
      },
      headers: { authorization: `Bearer ${h.tokens[user]}`, origin: 'http://localhost:3000' },
    });
  return { h, seed };
}

describe('B651: GET b640/connections', () => {
  it('без сессии и без флага — 404, неверный запрос — 400', async () => {
    const { h } = await setup();
    expect((await h.get(BASE)).statusCode).toBe(404);
    expect((await h.get(BASE, 'plain.test')).statusCode).toBe(404);
    expect((await h.get(`${BASE}?limit=21`, 'flagged.test')).statusCode).toBe(400);
    expect((await h.get(`${BASE}?pool=1`, 'flagged.test')).statusCode).toBe(400);
  });

  it('отмечает компании подборки, не отдаёт чужие связи, почту и телефон', async () => {
    const { h, seed } = await setup();
    await seed('anna', 'Анна Ким', 'Альфа', 'flagged.test');
    await seed('boris', 'Борис Орлов', 'Ромашка', 'flagged.test');
    await seed('other', 'Чужой Знакомый', 'Ромашка', 'other.test');
    const all = (await h.get(BASE, 'flagged.test')).json();
    expect(all.data).toMatchObject({
      total: 2,
      connections: 2,
      selectionCompanies: 1,
      selectionPending: false,
    });
    expect(all.data.items[0]).toMatchObject({
      fullName: 'Борис Орлов',
      inSelection: true,
      vacancyId: 'c1',
      circle: 1,
    });
    expect(JSON.stringify(all)).not.toMatch(/email|phone|Чужой/iu);
    const pool = (await h.get(`${BASE}?pool=true`, 'flagged.test')).json();
    expect(pool.data.items.map((item: { fullName: string }) => item.fullName)).toEqual([
      'Борис Орлов',
    ]);
  });
});
