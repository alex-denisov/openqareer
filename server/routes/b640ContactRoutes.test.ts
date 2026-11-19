import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/contacts';
const OLD = '/api/v1/candidate/connection-contacts';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup() {
  const h = await createB640Harness({ pool: () => [poolItem({ id: 'c1', title: 'Директор по данным', company: 'Ромашка' })] });
  closers.push(h.close);
  const send = (method: 'GET' | 'PUT', url: string, user?: HarnessUser, payload?: object) =>
    h.app.inject({
      method, url, ...(payload ? { payload } : {}),
      headers: { ...(user ? { authorization: `Bearer ${h.tokens[user]}` } : {}), origin: 'http://localhost:3000' },
    });
  const seed = (id: string, body: object, user: HarnessUser = 'flagged.test') =>
    send('PUT', `${OLD}/${id}`, user, { roleTitle: '', relationship: 'Коллега', strength: 'strong', ...body });
  return { h, send, seed };
}

describe('B697: GET b640/contacts', () => {
  it('без флага и без сессии — 404, прежний маршрут отвечает как раньше', async () => {
    const { send, seed } = await setup();
    expect((await send('GET', BASE)).statusCode).toBe(404);
    expect((await send('GET', BASE, 'plain.test')).statusCode).toBe(404);
    expect((await send('PUT', `${BASE}/x/status`, 'plain.test', { state: 'written' })).statusCode).toBe(404);
    expect((await seed('anna', { fullName: 'Анна Ким', companyName: 'Альфа' }, 'plain.test')).statusCode).toBe(201);
    const old = await send('GET', OLD, 'plain.test');
    expect(old.statusCode).toBe(200);
    expect(old.json().data.items[0]).toMatchObject({ id: 'anna', fullName: 'Анна Ким' });
  });

  it('отдаёт контакты, поиск, фильтр, фасеты, подборку, без почты и телефона', async () => {
    const { send, seed } = await setup();
    await seed('anna', { fullName: 'Анна Ким', companyName: 'Альфа' });
    await seed('boris', { fullName: 'Борис Орлов', companyName: 'Ромашка', roleTitle: 'CTO' });
    const all = (await send('GET', BASE, 'flagged.test')).json();
    expect(all.data.total).toBe(2);
    expect(all.data.facets.link).toEqual({ direct: 2, intro: 0, none: 0 });
    expect(all.data.items[0]).toMatchObject({ id: 'boris', inSelection: true, link: 'direct', linkNote: 'Коллега', status: { state: 'none', at: null } });
    expect(JSON.stringify(all)).not.toMatch(/email|phone/iu);
    const found = (await send('GET', `${BASE}?search=ОРЛОВ&company=${encodeURIComponent('Ромашка')}&company=Альфа&sort=name&limit=1`, 'flagged.test')).json();
    expect(found.data.items.map((item: { id: string }) => item.id)).toEqual(['boris']);
    expect(found.data.facets.companies).toEqual([{ name: 'Ромашка', count: 1 }]);
    expect((await send('GET', `${BASE}?limit=21`, 'flagged.test')).statusCode).toBe(400);
    expect((await send('GET', `${BASE}?search=${'я'.repeat(121)}`, 'flagged.test')).statusCode).toBe(400);
  });
});

describe('B697: PUT b640/contacts/:id/status', () => {
  it('сохраняет статус на сервере, видит его список, none сбрасывает', async () => {
    const { send, seed } = await setup();
    await seed('anna', { fullName: 'Анна Ким', companyName: 'Альфа' });
    const put = await send('PUT', `${BASE}/anna/status`, 'flagged.test', { state: 'replied' });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toMatchObject({ contactId: 'anna', state: 'replied' });
    const list = (await send('GET', `${BASE}?status=replied`, 'flagged.test')).json();
    expect(list.data.items[0].status).toMatchObject({ state: 'replied', at: put.json().data.at });
    expect(list.data.facets.status).toEqual({ none: 0, written: 0, replied: 1 });
    const reset = await send('PUT', `${BASE}/anna/status`, 'flagged.test', { state: 'none' });
    expect(reset.json().data).toEqual({ contactId: 'anna', state: 'none', at: null });
  });

  it('чужой и несуществующий контакт — 404, плохое тело — 400', async () => {
    const { send, seed } = await setup();
    await seed('anna', { fullName: 'Анна Ким', companyName: 'Альфа' });
    expect((await send('PUT', `${BASE}/anna/status`, 'other.test', { state: 'written' })).statusCode).toBe(404);
    expect((await send('PUT', `${BASE}/nobody/status`, 'flagged.test', { state: 'written' })).statusCode).toBe(404);
    expect((await send('PUT', `${BASE}/anna/status`, 'flagged.test', { state: 'bad' })).statusCode).toBe(400);
  });
});
