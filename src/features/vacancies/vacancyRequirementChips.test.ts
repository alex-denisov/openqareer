import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../shared/vacancyFit';
import { fitRequirementChips } from './vacancyRequirementChips';

function requirement(id: string, text: string) {
  return {
    id,
    text,
    sourceQuote: text,
    origin: 'explicit',
    importance: 'high',
    stopFactor: false,
  } as unknown as VacancyFitView['requirements'][number];
}

describe('fitRequirementChips', () => {
  it('returns null when the fit has no parsed requirements', () => {
    expect(fitRequirementChips(undefined)).toBeNull();
    expect(fitRequirementChips({ state: 'processing', requirements: [] })).toBeNull();
  });

  it('splits requirements into confirmed and unconfirmed by assessment', () => {
    const view = {
      state: 'ready',
      requirements: [requirement('a', 'Kafka'), requirement('b', 'Go'), requirement('c', 'SQL')],
      result: {
        assessments: [
          { requirementId: 'a', status: 'matched', evidence: [] },
          { requirementId: 'b', status: 'unmatched', evidence: [] },
        ],
      },
    } as unknown as VacancyFitView;
    expect(fitRequirementChips(view)).toEqual({
      confirmed: ['Kafka'],
      unconfirmed: ['Go', 'SQL'],
    });
  });

  it('drops duplicate requirement texts', () => {
    const view: VacancyFitView = {
      state: 'ready',
      requirements: [requirement('a', 'Kafka'), requirement('b', 'kafka')],
    };
    expect(fitRequirementChips(view)).toEqual({ confirmed: [], unconfirmed: ['Kafka'] });
  });
});
