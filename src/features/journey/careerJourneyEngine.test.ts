import { describe, expect, it } from 'vitest';
import {
  completeCandidateAnalysis,
  createCandidateAnalysis,
} from '../evidence/evidenceEngine';
import { createWorkspace } from '../workspace/workspaceStorage';
import { createActionPackage } from '../action/actionPackageEngine';
import {
  analyzeOpportunity,
  createOpportunityRecord,
  recordOpportunityDecision,
} from '../opportunity/opportunityEngine';
import {
  buildCareerJourney,
  prepareCareerWorkspace,
} from './careerJourneyEngine';

describe('buildCareerJourney', () => {
  it('keeps a conversation-only problem out of resume evidence and role hypotheses', () => {
    const workspace = prepareCareerWorkspace(
      {
        careerGoal: 'find-job',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Synthetic Product Operations Lead',
        market: 'international',
        currentSituation:
          'Синтетическая проверка: мало приглашений после смены позиционирования.',
        constraints: 'Только удалённо.',
        urgency: 'active',
      },
      '2026-08-09T12:00:00.000Z',
    );

    const journey = buildCareerJourney(
      workspace,
      '2026-08-09T12:05:00.000Z',
    );

    expect(workspace.analysis).toBeUndefined();
    expect(journey.roles).toEqual([]);
    expect(journey.nextAction).toMatchObject({
      id: 'inspect-job-search',
      headline: 'Сначала проверим основу поиска',
      destination: 'profile',
    });
    expect(journey.diagnostic).toMatchObject({
      coverage: { sourceKinds: ['conversation'], isPartial: true },
      nextAction: { findingIds: ['readability-short'] },
    });
    expect(journey.diagnostic.summary).toContain('частич');
    expect(JSON.stringify(journey.diagnostic)).not.toMatch(/score|балл/iu);
  });

  it('asks for evidence instead of inventing roles for a conversation-only start', () => {
    const workspace = createWorkspace(
      {
        resumeText: '',
        resumeSource: 'text',
        targetDirection: '',
        market: 'ru',
        currentSituation:
          'Я давно не получаю приглашений и не понимаю, какую роль искать.',
        constraints: 'Хочу работать удалённо, но пока не знаю в какой стране.',
        urgency: 'exploring',
      },
      '2026-08-07T12:00:00.000Z',
    );

    const journey = buildCareerJourney(
      workspace,
      '2026-08-07T12:05:00.000Z',
    );

    expect(journey.profile.state).toBe('forming');
    expect(journey.roles).toEqual([]);
    expect(journey.nextAction).toMatchObject({
      id: 'clarify-experience',
      destination: 'profile',
    });
    expect(journey.track[0]).toMatchObject({
      id: 'career-picture',
      status: 'active',
    });
  });

  it('turns confirmed source evidence into role hypotheses and a market decision', () => {
    const workspace = createWorkspace(
      {
        resumeText:
          'Руководил операционной командой из 18 человек. Сократил время ответа поддержки на 35 процентов. Отвечал за бюджет, процессы и качество сервиса в трёх регионах.',
        resumeSource: 'pdf',
        targetDirection: 'Руководитель операций',
        market: 'international',
        currentSituation:
          'Ищу следующую управленческую роль и рассматриваю удалённую работу.',
        constraints: 'Удалённо или релокация при наличии понятного пакета.',
        urgency: 'active',
      },
      '2026-08-07T12:00:00.000Z',
    );
    const extracted = createCandidateAnalysis(workspace.resumeText);
    const confirmed = {
      ...extracted,
      evidenceItems: extracted.evidenceItems.map((item) => ({
        ...item,
        status: 'confirmed' as const,
      })),
    };
    const withAnalysis = {
      ...workspace,
      analysis: completeCandidateAnalysis(
        workspace.targetDirection,
        confirmed,
        '2026-08-07T12:03:00.000Z',
      ),
    };

    const journey = buildCareerJourney(
      withAnalysis,
      '2026-08-07T12:05:00.000Z',
    );

    expect(journey.profile.state).toBe('grounded');
    expect(journey.roles[0]).toMatchObject({
      title: 'Руководитель операций',
      fitState: 'plausible',
    });
    expect(journey.markets[0]).toMatchObject({
      id: 'international',
      state: 'needs-sample',
    });
    expect(journey.nextAction.id).toBe('compare-markets');
    expect(journey.track).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'role-market', status: 'active' }),
        expect.objectContaining({ id: 'positioning', status: 'waiting' }),
      ]),
    );
    expect(journey.commercialBoundary).toMatchObject({
      state: 'free-route-incomplete',
    });

    const insufficient = buildCareerJourney(
      {
        ...withAnalysis,
        market: 'ru',
        marketSample: {
          source: 'hh',
          query: 'Руководитель операций',
          found: 42,
          fetchedAt: '2026-08-07T12:04:00.000Z',
          items: [],
        },
      },
      '2026-08-07T12:06:00.000Z',
    );
    expect(insufficient.markets[0]).toMatchObject({ state: 'needs-sample' });
    expect(insufficient.nextAction.id).toBe('compare-markets');

    const sampled = buildCareerJourney(
      {
        ...withAnalysis,
        market: 'ru',
        marketSample: {
          source: 'hh',
          query: 'Руководитель операций',
          found: 42,
          fetchedAt: '2026-08-07T12:04:00.000Z',
          items: Array.from({ length: 5 }, (_, index) => ({
            id: `vacancy-${index + 1}`,
            title: 'Руководитель операций',
            company: `Компания ${index + 1}`,
            location: 'Москва',
            sourceUrl: `https://hh.ru/vacancy/${index + 1}`,
            publishedAt: null,
            salary: null,
          })),
        },
      },
      '2026-08-07T12:06:00.000Z',
    );
    expect(sampled.markets[0].state).toBe('sample-ready');
    expect(sampled.nextAction).toMatchObject({
      id: 'review-opportunities',
      destination: 'opportunities',
    });
    expect(sampled.track).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'role-market', status: 'complete' }),
        expect.objectContaining({ id: 'positioning', status: 'active' }),
      ]),
    );
    expect(sampled.commercialBoundary).toMatchObject({
      state: 'assisted-setup-eligible',
    });

    const stale = buildCareerJourney(
      {
        ...withAnalysis,
        market: 'ru',
        marketSample: {
          source: 'hh',
          query: 'Руководитель операций',
          found: 42,
          fetchedAt: '2025-12-01T12:04:00.000Z',
          items: [],
        },
      },
      '2026-08-07T12:06:00.000Z',
    );
    expect(stale.markets[0]).toMatchObject({ state: 'needs-sample' });
    expect(stale.markets[0]?.explanation).toContain('устарела');
    expect(stale.nextAction.id).toBe('compare-markets');
  });

  it('asks for another result when every extracted fact is already confirmed', () => {
    const workspace = createWorkspace(
      {
        resumeText:
          'Управлял операционной командой и отвечал за ежедневную работу поддержки клиентов.',
        resumeSource: 'text',
        targetDirection: 'Руководитель операций',
        market: 'ru',
        currentSituation:
          'Хочу понять, достаточно ли моего опыта для следующей управленческой роли.',
        constraints: 'Рассматриваю гибридный или удалённый формат.',
        urgency: 'exploring',
      },
      '2026-08-07T12:00:00.000Z',
    );
    const extracted = createCandidateAnalysis(workspace.resumeText);
    const withAnalysis = {
      ...workspace,
      analysis: completeCandidateAnalysis(
        workspace.targetDirection,
        {
          ...extracted,
          evidenceItems: extracted.evidenceItems.map((item) => ({
            ...item,
            status: 'confirmed' as const,
          })),
        },
        '2026-08-07T12:03:00.000Z',
      ),
    };

    const journey = buildCareerJourney(
      withAnalysis,
      '2026-08-07T12:05:00.000Z',
    );

    expect(journey.profile.proposedEvidence).toBe(0);
    expect(journey.profile.state).toBe('forming');
    expect(journey.nextAction).toMatchObject({
      id: 'add-result-evidence',
      destination: 'profile',
    });
  });

  it('moves from vacancy comparison to the saved action package', () => {
    const base = createWorkspace(
      {
        careerGoal: 'find-job',
        resumeText:
          'Руководил продуктовой командой из восьми человек. Сократил срок проверки продуктовых гипотез на 30 процентов. Отвечал за планирование, метрики и взаимодействие с коммерческой командой.',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation: 'Проверяю следующую продуктовую роль.',
        constraints: 'Гибридный формат.',
        urgency: 'active',
      },
      '2026-08-09T17:00:00.000Z',
    );
    const extracted = createCandidateAnalysis(base.resumeText);
    const analysis = completeCandidateAnalysis(
      base.targetDirection,
      {
        ...extracted,
        evidenceItems: extracted.evidenceItems.map((item) => ({
          ...item,
          status: 'confirmed' as const,
        })),
      },
      '2026-08-09T17:01:00.000Z',
    );
    const record = createOpportunityRecord(
      {
        title: 'Senior Product Manager',
        company: 'Пример',
        sourceLabel: 'Ручной ввод',
        text: `
Задачи
Формировать продуктовую стратегию и руководить продуктовой командой.
Требования
Опыт работы с продуктовыми метриками и планированием.
`,
      },
      '2026-08-09T17:03:00.000Z',
    );
    const analyzed = {
      ...record,
      analysis: analyzeOpportunity(record, analysis.evidenceItems, 'unknown'),
    };
    const opportunity = recordOpportunityDecision(
      analyzed,
      'network',
      'Сначала уточню scope роли и формат работы у команды.',
      '2026-08-09T17:04:00.000Z',
    );
    const actionPackage = createActionPackage(
      opportunity,
      analysis.evidenceItems,
      base.targetDirection,
      '2026-08-09T17:05:00.000Z',
    );
    const workspace = {
      ...base,
      analysis,
      marketSample: {
        source: 'hh' as const,
        query: base.targetDirection,
        found: 42,
        fetchedAt: '2026-08-09T17:02:00.000Z',
        items: Array.from({ length: 5 }, (_, index) => ({
          id: `vacancy-${index + 1}`,
          title: base.targetDirection,
          company: `Компания ${index + 1}`,
          location: 'Москва',
          sourceUrl: `https://hh.ru/vacancy/${index + 1}`,
          publishedAt: null,
          salary: null,
        })),
      },
      opportunity,
      actionPackage,
    };

    const journey = buildCareerJourney(
      workspace,
      '2026-08-09T17:06:00.000Z',
    );

    expect(journey.nextAction).toMatchObject({
      id: 'execute-action-package',
      headline: 'Сделаем первый контакт по выбранной вакансии',
      destination: 'opportunities',
    });
    expect(journey.track).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'positioning', status: 'complete' }),
        expect.objectContaining({ id: 'campaign', status: 'active' }),
      ]),
    );
  });
});
