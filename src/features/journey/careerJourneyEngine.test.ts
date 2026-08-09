import { describe, expect, it } from 'vitest';
import {
  completeCandidateAnalysis,
  createCandidateAnalysis,
} from '../evidence/evidenceEngine';
import { createWorkspace } from '../workspace/workspaceStorage';
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

    const sampled = buildCareerJourney(
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
    expect(sampled.markets[0].state).toBe('sample-ready');
    expect(sampled.nextAction).toMatchObject({
      id: 'review-opportunities',
      destination: 'opportunities',
    });
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
});
