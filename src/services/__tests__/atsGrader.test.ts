import { describe, expect, it } from 'vitest';
import { analyzeResumeATS } from '../atsGrader';

describe('analyzeResumeATS', () => {
  it('is deterministic and reports matched evidence from synthetic text', () => {
    const resume = [
      'Experience',
      'Built React and TypeScript services with Node.js and REST API.',
      'Improved performance by 30% and supported 10k users.',
      'Skills',
    ].join('\n');

    const first = analyzeResumeATS(resume, 'Synthetic target');
    const second = analyzeResumeATS(resume, 'Synthetic target');

    expect(first).toEqual(second);
    expect(first.matchedKeywords).toEqual(
      expect.arrayContaining(['React', 'TypeScript', 'Node.js', 'REST API']),
    );
    expect(first.foundMetricsCount).toBe(2);
    expect(first.score).toBeGreaterThanOrEqual(45);
  });

  it('handles an empty resume without throwing', () => {
    const result = analyzeResumeATS('');

    expect(result.score).toBe(45);
    expect(result.matchedKeywords).toEqual([]);
    expect(result.missingKeywords).toHaveLength(15);
    expect(result.improvements).toHaveLength(2);
  });
});

