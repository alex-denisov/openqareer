import { completeCandidateAnalysis } from '../evidence/evidenceEngine';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { prepareCareerWorkspace } from './careerJourneyEngine';

export function createDemoWorkspace(
  now: string = new Date().toISOString(),
): CandidateWorkspace {
  const base = prepareCareerWorkspace(
    {
      careerGoal: 'find-job',
      resumeText: [
        'Руководил операционной командой из 12 человек в B2B-сервисе.',
        'Запустил новый процесс обслуживания и сократил средний срок решения обращения на 30%.',
        'Отвечал за межфункциональные проекты, метрики и еженедельную операционную отчётность.',
      ].join(' '),
      resumeSource: 'text',
      targetDirection: 'Директор по операциям',
      market: 'ru',
      currentSituation:
        'Синтетический демо-кандидат выбирает следующий карьерный шаг.',
      constraints: 'Только демо-данные, не описывают реального человека.',
      urgency: 'exploring',
    },
    now,
  );
  if (!base.analysis) return base;

  const evidenceItems = base.analysis.evidenceItems.map((item) => ({
    ...item,
    status: 'confirmed' as const,
  }));
  const analysis = completeCandidateAnalysis(
    base.targetDirection,
    { ...base.analysis, evidenceItems },
    now,
  );

  return {
    ...base,
    analysis,
    marketSample: {
      source: 'hh',
      query: base.targetDirection,
      found: 18,
      fetchedAt: now,
      items: Array.from({ length: 5 }, (_, index) => ({
        id: `demo-vacancy-${index + 1}`,
        title: index === 0 ? 'Директор по операциям' : 'Руководитель операций',
        company: `Демо-компания ${index + 1}`,
        location: index % 2 === 0 ? 'Москва' : 'Удалённо',
        sourceUrl: `https://example.com/demo-vacancy-${index + 1}`,
        publishedAt: new Date(
          new Date(now).valueOf() - (index + 1) * 86_400_000,
        ).toISOString(),
        salary: null,
      })),
    },
  };
}
