import { describe, expect, it } from 'vitest';
import { buildCoachSubjectContext } from './coachSubjectContext';
import type { RouteDeps } from './deps';

const CLUSTER_ID = 'cluster-src-hh-search:138396558';
const DESCRIPTION = 'Ищем руководителя проектов разработки AI-платформы. Команда 12 человек.';

function depsWith(engine: Record<string, unknown>): RouteDeps {
  return {
    multiSourceEngine: engine,
    candidateStore: { getSnapshot: () => ({ memory: [] }) },
  } as unknown as RouteDeps;
}

const cluster = {
  id: CLUSTER_ID,
  canonicalTitle: 'Tech Lead / Руководитель проектов разработки AI-платформы',
  canonicalCompany: 'ГК Орбита',
  canonicalLocation: 'Москва',
  isRemote: false,
  workFormat: 'hybrid',
  salary: { from: 300_000, to: 400_000, currency: 'RUR', gross: false },
  descriptionSummary: 'Ищем руководителя проектов…',
  skills: ['Python', 'MLOps'],
  primaryUrl: 'https://hh.ru/vacancy/138396558',
};

describe('vacancy context the consultant receives', () => {
  // 28.10 on prod: from a vacancy card the consultant answered «нет данных по вакансии»,
  // retold the resume and asked the candidate to send the vacancy text.
  it('carries the vacancy text, salary, work format and source, not only title and skills', async () => {
    const context = await buildCoachSubjectContext(
      depsWith({
        getActiveCluster: () => cluster,
        loadVacancyDescription: async () => ({
          vacancy: { fullDescription: DESCRIPTION },
          unavailable: false,
          status: 'cached',
        }),
      }),
      'candidate-1',
      { kind: 'vacancy', id: CLUSTER_ID },
    );
    expect(context).toContain(
      'Вакансия: Tech Lead / Руководитель проектов разработки AI-платформы',
    );
    expect(context).toContain('Зарплата: 300 000–400 000 RUR на руки');
    expect(context).toContain('Формат работы: гибрид');
    expect(context).toContain('Источник: https://hh.ru/vacancy/138396558');
    expect(context).toContain(`Текст вакансии:\n${DESCRIPTION}`);
  });

  it('falls back to the summary when the full text cannot be loaded and stays within the model limit', async () => {
    const context = await buildCoachSubjectContext(
      depsWith({
        getActiveCluster: () => ({ ...cluster, descriptionSummary: 'x'.repeat(20_000) }),
        loadVacancyDescription: async () => {
          throw new Error('hh offline');
        },
      }),
      'candidate-1',
      { kind: 'vacancy', id: CLUSTER_ID },
    );
    expect(context).toContain('Текст вакансии:\nxxx');
    expect(context!.length).toBeLessThanOrEqual(10_000);
  });
});
