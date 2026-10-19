import type { VacancyFitView } from '../../shared/vacancyFit';
/** Synthetic provenance fixture, never a claim about a real candidate or vacancy. */
export function readyVacancyFit(vacancyId = 'fit-fixture'): VacancyFitView {
  const gate = { status: 'matched' as const, reason: 'Подтверждено тестовым фактом' };
  return {
    state: 'ready',
    requirements: [
      {
        id: 'r-one',
        text: 'Опыт управления продуктом',
        sourceQuote: 'Требуется опыт управления продуктом.',
        origin: 'explicit',
        importance: 'high',
        kind: 'experience',
        hard: true,
        stopFactor: false,
      },
      {
        id: 'r-two',
        text: 'Знание немецкого языка',
        sourceQuote: 'Немецкий язык будет плюсом.',
        origin: 'explicit',
        importance: 'low',
        kind: 'language',
        hard: false,
        stopFactor: false,
      },
    ],
    result: {
      candidateId: 'synthetic-candidate',
      vacancyId,
      algorithmVersion: 'evidence-coverage-2',
      status: 'assessed',
      calculatedAt: '2026-10-18T12:00:00.000Z',
      dataState: 'confirmed',
      gates: { role: gate, level: gate, region: gate, workAuthorization: gate, workFormat: gate },
      coveragePercent: 50,
      requiredCoverage: { matched: 1, total: 1, percent: 100 },
      coverage: { matched: 1, total: 2, unknown: 0 },
      assessments: [
        {
          requirementId: 'r-one',
          status: 'matched',
          evidence: [
            { factId: 'fixture-fact-01', quote: 'Управляла продуктом в тестовой компании.' },
          ],
        },
        { requirementId: 'r-two', status: 'unmatched', evidence: [] },
      ],
      reason: 'assessed',
    },
  };
}
