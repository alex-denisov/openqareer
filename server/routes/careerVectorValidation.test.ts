import { describe, expect, it } from 'vitest';
import { putCareerVectorSchema } from './careerVectorValidation';

const valid = {
  choices: { priority: 'priority_scale' },
  antiGoals: ['Продажи'],
  compromises: { grade: 'none', salary: 'up_to_10' },
};

describe('putCareerVectorSchema', () => {
  it('принимает известные вопросы и варианты', () => {
    expect(putCareerVectorSchema.safeParse(valid).success).toBe(true);
  });
  it('отклоняет неизвестный вариант и неизвестный вопрос', () => {
    expect(putCareerVectorSchema.safeParse({ ...valid, choices: { priority: 'nope' } }).success).toBe(false);
    expect(putCareerVectorSchema.safeParse({ ...valid, choices: { zzz: 'priority_scale' } }).success).toBe(false);
  });
  it('не принимает вектор от клиента', () => {
    expect(putCareerVectorSchema.safeParse({ ...valid, vector: 'relocation' }).success).toBe(false);
  });
  it('отклоняет неверные компромиссы', () => {
    expect(putCareerVectorSchema.safeParse({ ...valid, compromises: { grade: 'x', salary: 'none' } }).success).toBe(false);
  });
});
