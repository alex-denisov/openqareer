import { describe, expect, it } from 'vitest';
import { ASSESSMENT_METHOD_VERSION, assessProfile } from './profileAssessment';
import type { CandidateProfileView } from './profileView';

/**
 * «Пульт» рисует кольцо «68 из 100» и четыре шкалы. Ни одну из них нельзя
 * взять из воздуха: правило продукта запрещает оценку без источника, выборки и
 * даты (находка 8 аудита B178). Поэтому кольцо здесь — доля пройденных
 * проверок, а каждая шкала называет свой знаменатель (B179).
 */
const view: CandidateProfileView = {
  fullName: 'Alexey Denisov',
  targetRole: 'VP of Technology',
  about: 'О себе.',
  experience: [
    {
      id: 'e1',
      title: 'VP of Technology',
      employer: 'Enterprise Energy IT Services',
      period: 'апрель 2023 — октябрь 2025',
      duration: '2 г. 7 мес.',
      current: false,
      bullets: ['Grew revenue 4x', 'Owned operations'],
      measurableBullets: 1,
    },
  ],
  skills: ['Executive Leadership'],
  education: [{ id: 'ed1', institution: 'УТМ', qualification: 'BE', period: '2005 — 2010' }],
  languages: ['English'],
};

describe('assessProfile', () => {
  it('считает разделы профиля по тому, что в них есть', () => {
    const { measures } = assessProfile({ view, targetDirection: 'VP of Technology' });
    const sections = measures.find((measure) => measure.id === 'sections');

    expect(sections).toMatchObject({ value: 5, total: 5 });
  });

  it('считает пункты с числом отдельной мерой', () => {
    const { measures } = assessProfile({ view, targetDirection: 'VP of Technology' });

    expect(measures.find((measure) => measure.id === 'measurable-results')).toMatchObject({
      value: 1,
      total: 2,
    });
  });

  it('кольцо — доля пройденных проверок, а не выдуманное число', () => {
    const { score } = assessProfile({ view, targetDirection: 'VP of Technology' });

    // 5/5 разделов + 1/2 пунктов + 1/1 датированное место + 1/1 роль = 8 из 9.
    expect(score).toEqual({ value: 89, checks: 8, total: 9 });
  });

  it('пустой профиль не даёт ни меры, ни кольца', () => {
    const empty = assessProfile({
      view: { experience: [], skills: [], education: [], languages: [] },
      targetDirection: '',
    });

    expect(empty.measures).toEqual([]);
    expect(empty.score).toBeUndefined();
    expect(empty.methodVersion).toBe(ASSESSMENT_METHOD_VERSION);
  });

  it('место работы без дат видно в мере, а не спрятано', () => {
    const undated = assessProfile({
      view: {
        ...view,
        experience: [{ ...view.experience[0], period: '', duration: '' }],
      },
      targetDirection: 'VP of Technology',
    });

    expect(undated.measures.find((measure) => measure.id === 'dated-experience')).toMatchObject({
      value: 0,
      total: 1,
    });
  });
});
