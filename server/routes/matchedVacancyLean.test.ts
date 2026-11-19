import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem } from '../testHelpers/b640VacancyHarness';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { forgetMatchedListsForTests } from './matchedVacancyList';

const OLD = '/api/v1/candidate/matched-vacancies';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  forgetMatchedListsForTests();
});

/** Строка весом ~3 КБ: страница по 40 КБ берёт меньше двадцати таких строк. */
function heavyRow(index: number): MatchedVacancyItem {
  const base = poolItem({
    id: `v-${index}`,
    title: `Инженер ${index}`,
    company: `Компания ${index}`,
  });
  return {
    ...base,
    explanation: {
      ...base.explanation,
      summary: 'Совпало 1 из 2 требований вакансии. '.repeat(70),
      matchingPoints: ['SQL', 'Python', 'Airflow', 'dbt'],
      missingPoints: ['Kafka'],
      matchingFacts: [{ text: 'SQL' }],
    },
  } as MatchedVacancyItem;
}

async function setup(size = 45) {
  const harness = await createB640Harness({
    pool: () => Array.from({ length: size }, (_, index) => heavyRow(index)),
  });
  closers.push(harness.close);
  return harness;
}

describe('B725: облегчённые строки подбора для кабинета B640', () => {
  it('аккаунт с флагом получает по 20 строк без списков требований и план, кратный 20', async () => {
    const { get } = await setup();
    const first = (await get(`${OLD}?offset=0`, 'flagged.test')).json();
    expect(first.data).toHaveLength(20);
    expect(first.meta.pageOffsets).toEqual([0, 20, 40]);
    expect(first.data[0].explanation).toMatchObject({
      matchingPoints: [],
      missingPoints: [],
      matchingCount: 4,
      missingCount: 1,
    });
    expect(first.data[0].explanation.matchingFacts).toBeUndefined();
    const last = (await get(`${OLD}?offset=40`, 'flagged.test')).json();
    expect(last.data.map((row: { cluster: { id: string } }) => row.cluster.id)).toEqual([
      'v-40',
      'v-41',
      'v-42',
      'v-43',
      'v-44',
    ]);
    expect(last.meta.nextOffset).toBeNull();
  });

  it('аккаунт без флага получает прежние страницы по байтам со списками', async () => {
    const { get } = await setup();
    const first = (await get(`${OLD}?offset=0`, 'plain.test')).json();
    expect(first.data.length).toBeLessThan(20);
    expect(first.meta.pageOffsets[1]).toBe(first.data.length);
    expect(first.data[0].explanation.matchingPoints).toEqual(['SQL', 'Python', 'Airflow']);
  });

  it('весь пул по плану читается без дыр и повторов', async () => {
    const { get } = await setup(87);
    const first = (await get(`${OLD}?offset=0`, 'flagged.test')).json();
    const ids: string[] = [];
    for (const offset of first.meta.pageOffsets as number[]) {
      const page = (await get(`${OLD}?offset=${offset}`, 'flagged.test')).json();
      ids.push(...page.data.map((row: { cluster: { id: string } }) => row.cluster.id));
    }
    expect(ids).toEqual(Array.from({ length: 87 }, (_, index) => `v-${index}`));
  });
});
