import { describe, expect, it } from 'vitest';
import { scoreQuiz } from '../../public/assets/oq-interview-2.js';

const items = [{ correct: 1 }, { correct: 0 }, { correct: 2 }, { correct: 1 }, { correct: 0 }];

describe('B568 interview quiz', () => {
  it('counts right answers and treats skipped ones as wrong', () => {
    expect(scoreQuiz(items, [1, 0, 2, 1, 0])).toBe(5);
    expect(scoreQuiz(items, [0, 1, 2, 1, 0])).toBe(3);
    expect(scoreQuiz(items, [])).toBe(0);
  });
});
