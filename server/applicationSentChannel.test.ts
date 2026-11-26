import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';

const clusterId = 'cluster-src-fh-getmatch:37138';
const pool = {
  title: 'Руководитель',
  company: 'ЭР-Телеком',
  url: 'https://getmatch.ru/vacancies/37138',
  source: 'src-fh-getmatch',
  description: 'Описание',
};
const hh = { ...pool, url: 'https://hh.ru/vacancy/139105692', source: 'hh' };

function setup() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
  });
  const { id } = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const card = store.createApplication(id, { clusterId, stage: 'saved', vacancy: pool });
  return { store, id, card };
}

describe('B678: площадка отправленного отклика', () => {
  it('берётся из записи отправки, а не из снимка подборки', () => {
    const { store, id, card } = setup();
    store.recordVacancyApplication(id, { clusterId, status: 'applied', vacancy: hh });
    const expected = { ...pool, url: hh.url, source: 'hh' };
    expect(store.getApplication(id, card.id)?.vacancy).toEqual(expected);
    expect(store.listApplications(id)[0].vacancy).toEqual(expected);
    store.close();
  });

  it('не меняется, когда вакансию открыли или отметили ещё раз с другой площадки', () => {
    const { store, id, card } = setup();
    store.recordVacancyApplication(id, { clusterId, status: 'applied', vacancy: hh });
    store.recordVacancyApplication(id, { clusterId, status: 'opened', vacancy: pool });
    store.recordVacancyApplication(id, { clusterId, status: 'applied', vacancy: pool });
    expect(store.getApplication(id, card.id)?.vacancy?.source).toBe('hh');
    store.close();
  });

  it('открытая, но неотправленная вакансия снимок не меняет', () => {
    const { store, id, card } = setup();
    store.recordVacancyApplication(id, { clusterId, status: 'opened', vacancy: hh });
    expect(store.getApplication(id, card.id)?.vacancy).toEqual(pool);
    store.close();
  });
});
