import { describe, expect, it } from 'vitest';
import { buildCareerDiagnostic } from '../diagnostic/careerDiagnostic';
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
});
