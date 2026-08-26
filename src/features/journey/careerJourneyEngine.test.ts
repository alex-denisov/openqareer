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
import { recordOutcome } from '../outcome/outcomeEngine';
import {
  applyCanonicalProfileToJourney,
  buildCanonicalProfileJourney,
  buildCareerJourney,
  prepareCareerWorkspace,
} from './careerJourneyEngine';

describe('buildCareerJourney', () => {
  it('turns one confirmed dialogue episode into traceable role hypotheses and an active route', () => {
    const journey = buildCanonicalProfileJourney(
      undefined,
      [
        {
          id: 'confirmed-product-result',
          statement:
            'Руководил запуском продукта для 1200 пользователей и сократил срок релиза на 30 процентов.',
          kind: 'fact',
          domain: 'outcome',
          status: 'confirmed',
          sourceMessageIds: ['message-1'],
        },
      ],
      '',
      '2026-08-14T00:00:00.000Z',
    );

    expect(journey.roles.length).toBeGreaterThanOrEqual(1);
    expect(journey.roles.length).toBeLessThanOrEqual(3);
    expect(journey.roles[0]).toMatchObject({
      evidenceCount: 1,
    });
    expect(journey.roles.map((role) => role.title).join(' ')).toMatch(/product/iu);
    expect(journey.track.find((item) => item.id === 'role-market')).toMatchObject({
      status: 'active',
    });
    expect(journey.reasonedAction).toMatchObject({
      expectedChange: expect.any(String),
      approvalBoundary: expect.stringMatching(/соглас/iu),
      alternatives: expect.arrayContaining([
        expect.objectContaining({ id: 'correct-premise' }),
      ]),
    });
  });

  it('builds a partial diagnostic from server profile memory without local workspace', () => {
    const journey = buildCanonicalProfileJourney(
      undefined,
      [
        {
          id: 'server-only-result',
          statement: 'Сократил срок запуска на 30 процентов.',
          kind: 'fact',
          domain: 'outcome',
          status: 'proposed',
          sourceMessageIds: ['message-1'],
        },
      ],
      'Руководитель продукта',
      '2026-08-14T00:00:00.000Z',
    );

    expect(journey.profile).toMatchObject({
      state: 'needs-review',
      proposedEvidence: 1,
      sourceLabel: 'Диалог и канонический профиль',
    });
    expect(journey.diagnostic.coverage).toMatchObject({
      sourceKinds: ['conversation'],
      isPartial: true,
      profileEvidence: { proposed: 1 },
    });
    expect(
      journey.diagnostic.findings.find((finding) => finding.dimension === 'ats'),
    ).toMatchObject({ certainty: 'unknown', status: 'unknown' });
    expect(journey.nextAction).toMatchObject({
      id: 'review-evidence',
      destination: 'profile',
    });
  });

  it('rebuilds the visible profile and diagnostic from canonical dialogue memory', () => {
    const workspace = createWorkspace(
      {
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        regions: ['ru'],
        currentSituation: 'Хочу проверить следующий карьерный шаг.',
        constraints: '',
        urgency: 'exploring',
      },
      '2026-08-14T00:00:00.000Z',
    );
    const base = buildCareerJourney(workspace, '2026-08-14T00:01:00.000Z');

    const journey = applyCanonicalProfileToJourney(base, [
      {
        id: 'result-memory',
        kind: 'fact',
        domain: 'outcome',
        status: 'proposed',
        sourceMessageIds: ['message-1'],
      },
      {
        id: 'question-memory',
        kind: 'open-question',
        domain: 'gap',
        status: 'proposed',
        sourceMessageIds: ['message-2'],
        statement: 'Как измерялся результат?',
      },
    ]);

    expect(journey.profile).toMatchObject({
      state: 'needs-review',
      confirmedEvidence: 0,
      proposedEvidence: 1,
      importantUnknowns: ['Как измерялся результат?'],
      sourceLabel: 'Диалог и канонический профиль',
    });
    expect(journey.nextAction).toMatchObject({
      id: 'review-evidence',
      destination: 'profile',
    });
    expect(
      journey.diagnostic.findings.find((finding) => finding.dimension === 'evidence'),
    ).toMatchObject({ sourceRefs: ['memory:result-memory'] });
    expect(JSON.stringify(journey)).not.toMatch(/score|балл/iu);
  });

  it('routes a confirmed profile without an outcome back to the dialogue', () => {
    const journey = buildCanonicalProfileJourney(
      undefined,
      ['запуск продукта', 'команду', 'бюджет'].map((statement, index) => ({
        id: `confirmed-responsibility-${index}`,
        statement: `Отвечал за ${statement}.`,
        kind: 'fact' as const,
        domain: 'responsibility' as const,
        status: 'confirmed' as const,
        sourceMessageIds: [`message-${index}`],
      })),
    );

    expect(journey.profile.state).toBe('forming');
    expect(journey.nextAction).toMatchObject({
      id: 'add-result-evidence',
      destination: 'today',
    });
  });

  it('keeps a conversation-only problem out of resume evidence and role hypotheses', () => {
    const workspace = prepareCareerWorkspace(
      {
        careerGoal: 'find-job',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Synthetic Product Operations Lead',
        regions: ['eu'],
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
        regions: ['ru'],
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
        regions: ['eu'],
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
      id: 'eu',
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
        regions: ['ru'],
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
        regions: ['ru'],
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
        regions: ['ru'],
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
        regions: ['ru'],
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
        regions: ['ru'],
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

    const contacted = recordOutcome(
      opportunity.id,
      {
        type: 'contacted',
        occurredAt: '2026-08-09T17:07:00.000Z',
        note: 'Сообщение отправлено в официальном интерфейсе.',
      },
      '2026-08-09T17:08:00.000Z',
    );
    const afterContact = buildCareerJourney(
      { ...workspace, outcomes: [contacted] },
      '2026-08-09T17:09:00.000Z',
    );

    expect(afterContact.nextAction).toMatchObject({
      id: 'outcome-set-follow-up',
      headline: 'Назначить дату проверки ответа',
      destination: 'opportunities',
    });
  });
});

describe('market routes follow the regions the candidate chose (B158)', () => {
  const base = {
    resumeText: '',
    resumeSource: 'text' as const,
    targetDirection: 'Руководитель продукта',
    currentSituation: 'Хочу проверить следующий карьерный шаг.',
    constraints: '',
    urgency: 'exploring' as const,
  };

  it('shows one route per chosen region instead of a single binary market', () => {
    const journey = buildCareerJourney(
      createWorkspace(
        { ...base, regions: ['ru', 'mena'] },
        '2026-08-26T00:00:00.000Z',
      ),
      '2026-08-26T00:01:00.000Z',
    );

    expect(journey.markets.map((market) => market.id)).toEqual(['ru', 'mena']);
    expect(journey.markets.map((market) => market.label)).toEqual([
      'Россия',
      'MENA',
    ]);
  });

  it('shows no route at all while the candidate has named no region', () => {
    const journey = buildCareerJourney(
      createWorkspace({ ...base, regions: [] }, '2026-08-26T00:00:00.000Z'),
      '2026-08-26T00:01:00.000Z',
    );

    expect(journey.markets).toEqual([]);
  });
});
