import { describe, expect, it } from 'vitest';
import type { CoachTurnStage } from '../coach/coachApi';
import { STARTER_PROMPTS_BY_STAGE, starterPromptsForStage } from './starterPrompts';

const stages: CoachTurnStage[] = [
  'today',
  'profile',
  'career',
  'vacancies',
  'responses',
  'interviews',
  'diary',
];

describe('consultant starter prompts', () => {
  it('has a Russian set of no more than three concise prompts for every stage', () => {
    expect(Object.keys(STARTER_PROMPTS_BY_STAGE).sort()).toEqual([...stages].sort());

    const allPrompts: string[] = [];
    for (const stage of stages) {
      const prompts = starterPromptsForStage(stage);
      expect(prompts.length).toBeLessThanOrEqual(3);
      expect(new Set(prompts).size).toBe(prompts.length);

      for (const prompt of prompts) {
        expect(prompt).toBe(prompt.trim());
        expect(prompt.length).toBeLessThanOrEqual(40);
        expect(prompt).toMatch(/[А-Яа-яЁё]/u);
        expect(prompt).not.toMatch(/\d/u);
        expect(prompt).not.toMatch(/hh\.ru|linkedin/iu);
        allPrompts.push(prompt);
      }
    }

    expect(new Set(allPrompts).size).toBe(allPrompts.length);
  });
});
