import { describe, expect, it } from 'vitest';
import { buildCareerDiagnostic } from '../diagnostic/careerDiagnostic';
import type {
  CareerDiagnostic,
  DiagnosticDimension,
} from '../diagnostic/careerDiagnostic';
import { buildRoleMarketMap } from '../career-map/roleMarketMap';
import { buildReasonedCareerAction } from './careerActionPolicy';

describe('reasoned career action policy', () => {
  it('asks a clarifying question for a conversation-only partial profile', () => {
    const diagnostic = buildCareerDiagnostic({
      resumeText: 'Кандидат рассказал о запуске сервиса. '.repeat(3),
      resumeSource: 'conversation',
      targetDirection: '',
    });
    const action = buildReasonedCareerAction({ diagnostic, roleMarketMap: null });

    expect(action.type).toBe('question');
    expect(action.destination).toBe('coach');
    expect(action.expectedChange).toContain('направлен');
  });

  it('prioritizes an evidence gap above cosmetic resume work', () => {
    const diagnostic = buildCareerDiagnostic({
      resumeText: 'Управлял поддержкой и улучшал процессы компании. '.repeat(12),
      resumeSource: 'text',
      targetDirection: 'Head of Support',
    });
    const action = buildReasonedCareerAction({ diagnostic, roleMarketMap: null });

    expect(action.findingIds).toEqual(['evidence-not-reviewed']);
    expect(action.destination).toBe('evidence');
    expect(action.headline).toContain('результат');
  });

  it('changes the route for low cold-outreach tolerance without scoring motivation', () => {
    const diagnostic = buildCareerDiagnostic({
      resumeText: 'Запустил продукт и увеличил удержание на 20 процентов. '.repeat(10),
      resumeSource: 'pdf',
      targetDirection: 'Product Manager',
      sourceUpdatedAt: '2026-07-01',
      analysis: {
        evidenceMethodVersion: 'evidence-local-v1',
        roleMethodVersion: 'role-hypotheses-local-v1',
        evidenceItems: [
          {
            id: 'ev-01',
            kind: 'result',
            sourceExcerpt: 'Увеличил удержание на 20 процентов.',
            statement: 'Увеличил удержание на 20 процентов.',
            status: 'confirmed',
            userEdited: false,
          },
        ],
        questions: [],
        roleHypotheses: [],
      },
    });
    const roleMarketMap = buildRoleMarketMap({
      roleHypotheses: [],
      evidence: [],
      markets: [],
    });
    const action = buildReasonedCareerAction({
      diagnostic,
      roleMarketMap,
      constraints: 'Не хочу писать незнакомым людям холодные сообщения.',
    });

    expect(action.alternatives.map((item) => item.label).join(' ')).toContain(
      'рефера',
    );
    expect(JSON.stringify(action)).not.toMatch(/мотивац|score|балл/iu);
  });

  it('always offers a premise correction and an explicit approval boundary', () => {
    const diagnostic = buildCareerDiagnostic({
      resumeText: 'Руководил операциями и достиг измеримого результата. '.repeat(10),
      resumeSource: 'pdf',
      targetDirection: 'Operations Lead',
    });
    const action = buildReasonedCareerAction({ diagnostic, roleMarketMap: null });

    expect(action.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'correct-premise',
          destination: 'profile',
        }),
      ]),
    );
    expect(action.approvalBoundary).toContain('соглас');
  });

  it.each([
    ['readability', 'profile', 'Добавим полный источник', 'Дополнить профиль'],
    ['ats', 'profile', 'Проверим оформление резюме', 'Проверить документ'],
    ['evidence', 'evidence', 'Подтвердим сильный результат', 'Проверить факты'],
    ['freshness', 'profile', 'Обновим карьерную историю', 'Обновить профиль'],
    ['contradictions', 'evidence', 'Сверим источники', 'Сверить факты'],
    ['market', 'career', 'Проверим роль на рынке', 'Открыть карьерную карту'],
  ] as const)(
    'routes a %s finding to its explicit candidate-controlled destination',
    (dimension, destination, headline, label) => {
      const diagnostic = diagnosticForDimension(dimension);
      const action = buildReasonedCareerAction({
        diagnostic,
        roleMarketMap: null,
      });

      expect(action).toMatchObject({ destination, headline, label });
      expect(action.expectedChange.length).toBeGreaterThan(20);
    },
  );

  it('asks when the referenced finding no longer exists', () => {
    const diagnostic = diagnosticForDimension('market');
    diagnostic.findings = [];
    diagnostic.coverage.sourceKinds = ['pdf'];
    diagnostic.nextAction.type = 'question';

    expect(
      buildReasonedCareerAction({ diagnostic, roleMarketMap: null }),
    ).toMatchObject({ type: 'question', destination: 'coach' });
  });

  it('keeps multiple grounded roles reversible before choosing a campaign', () => {
    const diagnostic = diagnosticForDimension('market');
    diagnostic.findings = [];
    const roleMarketMap = buildRoleMarketMap({
      evidence: [],
      markets: [],
      roleHypotheses: [
        {
          id: 'role-product',
          title: 'Product Lead',
          fitState: 'adjacent',
          basis: 'Продуктовый запуск',
          evidenceIds: [],
          gaps: ['Сверить уровень'],
        },
        {
          id: 'role-operations',
          title: 'Operations Lead',
          fitState: 'adjacent',
          basis: 'Операционный результат',
          evidenceIds: [],
          gaps: ['Сверить масштаб'],
        },
      ],
    });
    roleMarketMap.markets = [marketFixture()];

    const action = buildReasonedCareerAction({ diagnostic, roleMarketMap });

    expect(action).toMatchObject({
      type: 'decision',
      destination: 'career',
      roleIds: ['role-product', 'role-operations'],
    });
  });

  it('proposes one bounded vacancy check when no unresolved finding remains', () => {
    const diagnostic = diagnosticForDimension('market');
    diagnostic.findings = [];

    const roleMarketMap = buildRoleMarketMap({
      evidence: [],
      roleHypotheses: [
        {
          id: 'role-product',
          title: 'Product Lead',
          fitState: 'plausible',
          basis: 'Подтверждённый запуск',
          evidenceIds: [],
          gaps: [],
        },
      ],
      markets: [],
    });
    roleMarketMap.markets = [marketFixture()];

    const action = buildReasonedCareerAction({ diagnostic, roleMarketMap });

    expect(action).toMatchObject({ type: 'execute', destination: 'search' });
    expect(action.approvalBoundary).toContain('отдельного согласия');
  });
});

function diagnosticForDimension(
  dimension: DiagnosticDimension,
): CareerDiagnostic {
  const diagnostic = buildCareerDiagnostic({
    resumeText: 'Подтверждённый карьерный материал. '.repeat(10),
    resumeSource: 'pdf',
    targetDirection: 'Product Lead',
  });
  const finding = {
    id: `finding-${dimension}`,
    dimension,
    certainty: 'fact' as const,
    status: 'issue' as const,
    severity: 'medium' as const,
    title: `Проверка ${dimension}`,
    explanation: 'Нужно проверить исходные данные.',
    sourceRefs: ['resume:source'],
    correction: 'Исправить источник.',
  };
  return {
    ...diagnostic,
    coverage: { ...diagnostic.coverage, sourceKinds: ['pdf'] },
    findings: [finding],
    nextAction: {
      type: 'review',
      label: 'Проверить',
      reason: 'Выбранный факт сильнее всего изменит следующий шаг.',
      findingIds: [finding.id],
    },
  };
}

function marketFixture() {
  return {
    id: 'market-remote',
    geography: 'worldwide-remote' as const,
    label: 'Worldwide remote',
    workMode: 'remote' as const,
    sampleStatus: 'fresh' as const,
    certainty: 'fact' as const,
    sampleSize: 3,
    lastObservedAt: '2026-08-14T00:00:00.000Z',
    repeatedRequirements: ['Product discovery'],
    gaps: [],
  };
}
