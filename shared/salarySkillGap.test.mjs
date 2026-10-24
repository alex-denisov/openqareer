import { describe, it, expect } from 'vitest';
import {
  normalizeListedSkill,
  parseListedSkills,
  compareListedSkills,
} from '../public/assets/oq-salary-gap-1.js';
describe('explicit local skill list', () => {
  it('preserves technical punctuation and only normalizes case, Unicode width and spacing', () => {
    expect(normalizeListedSkill('  ＳＱＬ  ')).toBe('sql');
    const rows = compareListedSkills(
      parseListedSkills('C, SQL\n Node.js; sql'),
      ['C++', 'C#', 'C', 'SQL', 'Node.js', 'nodejs'].map((name) => ({
        name,
        count: 5,
        frequency: 50,
      })),
    );
    expect(rows.filter((row) => row.listed).map((row) => row.name)).toEqual([
      'C',
      'SQL',
      'Node.js',
    ]);
  });
  it('rejects empty, excessive and overlong values instead of silently changing user input', () => {
    for (const value of [
      '',
      ',;\n',
      'a'.repeat(4001),
      'a'.repeat(129),
      Array.from({ length: 51 }, (_, i) => `skill${i}`).join(','),
    ])
      expect(() => parseListedSkills(value)).toThrow();
  });
  it('keeps exact observed counts/frequencies and marks absent text without inferring ability', () => {
    const rows = compareListedSkills(parseListedSkills('SQL'), [
      { name: 'SQL', count: 7, frequency: 35 },
      { name: 'Go', count: 5, frequency: 25 },
    ]);
    expect(rows).toEqual([
      { name: 'SQL', count: 7, frequency: 35, listed: true },
      { name: 'Go', count: 5, frequency: 25, listed: false },
    ]);
  });
});
