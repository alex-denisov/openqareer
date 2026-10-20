import { describe, expect, it } from 'vitest';
import { adaptationTaskSuggestionSchema } from './adaptationCoach';
import { COACH_TURN_JSON_SCHEMA, coachTurnResultSchema, coachProviderTurnResultSchema } from '../server/domain/coach';

describe('B357 structured suggestion contract', () => {
  it('retains a maximum model answer with its server context label', () => {
    const result = { message: '[' + 'К'.repeat(600) + ']\n' + 'а'.repeat(6000), phase: 'discovery', memoryCandidates: [], nextQuestion: null, completeness: { known: [], unknown: [] }, safety: { needsHuman: false, reason: null } };
    expect(result.message.length).toBe(6603);
    expect(coachTurnResultSchema.safeParse(result).success).toBe(true);
    expect(coachProviderTurnResultSchema.safeParse(result).success).toBe(false);
    expect(COACH_TURN_JSON_SCHEMA.properties.message.maxLength).toBe(6000);
    expect(coachTurnResultSchema.safeParse({ ...result, message: 'а'.repeat(6701) }).success).toBe(false);
  });
  it('allows an ISO due date in the model schema and keeps an unknown date nullable', () => {
    const object = COACH_TURN_JSON_SCHEMA.properties.adaptationTask.anyOf.find(branch => branch.type === 'object');
    const date = object?.properties?.dueDate.anyOf[0];
    expect(date?.pattern).toBeDefined();
    const pattern = new RegExp(date?.pattern ?? '');
    expect(pattern.test('2026-11-01')).toBe(true);
    expect(pattern.test('01.11.2026')).toBe(false);
    expect(adaptationTaskSuggestionSchema.safeParse({ title: 'Уточнить ожидания', description: '', dueDate: null }).success).toBe(true);
    expect(adaptationTaskSuggestionSchema.safeParse({ title: 'Уточнить ожидания', description: '', dueDate: '2026-02-31' }).success).toBe(false);
  });
});
