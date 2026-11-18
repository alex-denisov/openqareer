import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from './domain/unifiedVacancy';
import { LETTER } from './testHelpers/letterApprovalHarness';
import { createApp, login } from './testHelpers/vacancyPitchHarness';

/**
 * B707: строка подборки получает id `cluster-<запись>` кластера, собранного на запросе. Если
 * сохранённого активного кластера для записи нет (склеен вокруг другого основателя, ещё не
 * пересобран), письмо собиралось по записи пула, а «Одобрить» отвечал 410 «снята».
 */
const SOURCE = 'src-hh-search';
const RECORD = `${SOURCE}:139180469`;
const ROW_ID = `cluster-${RECORD}`;

const vacancy: UnifiedVacancy = {
  id: RECORD,
  fingerprint: RECORD,
  title: 'Директор по данным',
  company: 'Ромашка',
  description: 'Строим платформу данных',
  requiredSkills: ['SQL'],
  isRemote: true,
  url: 'https://hh.ru/vacancy/139180469',
  publishedAt: '2026-11-17T00:00:00.000Z',
  status: 'active',
  provenance: {
    sourceType: 'json_api',
    sourceId: SOURCE,
    sourceUrl: 'https://hh.ru/vacancy/139180469',
    observedAt: '2026-11-18T00:00:00.000Z',
  },
} as UnifiedVacancy;

async function poolOnly() {
  const harness = await createApp([], { persisted: true });
  harness.poolStore.mergeSourceSlice(SOURCE, [vacancy]);
  // Как на проде: ни в куче процесса, ни среди сохранённых кластеров этой записи нет.
  harness.poolStore.replaceClusters([]);
  (harness.multiSourceEngine as unknown as { clusters: unknown[] }).clusters = [];
  const { cookie } = await login(harness.app);
  const post = (path: string, payload?: Record<string, unknown>) =>
    harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidate/vacancies/${encodeURIComponent(ROW_ID)}/${path}`,
      headers: { cookie, origin: 'http://localhost:3000' },
      ...(payload ? { payload } : {}),
    });
  return { ...harness, post };
}

describe('B707: одобрение письма к вакансии из подборки', () => {
  it('открытая вакансия без сохранённого кластера одобряется по записи пула', async () => {
    const { multiSourceEngine, post } = await poolOnly();
    expect(multiSourceEngine.getActiveCluster(ROW_ID)).toBeUndefined();

    const approved = await post('letter-approvals', LETTER);
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data).toMatchObject({ status: 'approved', sent: false });

    const resume = await post('letter-resume');
    expect(resume.statusCode).toBe(200);
  });

  it('снятая вакансия по-прежнему 410', async () => {
    const { poolStore, post } = await poolOnly();
    poolStore.markExpired([RECORD], '2026-11-18T01:00:00.000Z');

    const approved = await post('letter-approvals', LETTER);
    expect(approved.statusCode).toBe(410);
    expect(approved.json().error.code).toBe('vacancy_gone');
    expect((await post('letter-resume')).statusCode).toBe(410);
  });
});
