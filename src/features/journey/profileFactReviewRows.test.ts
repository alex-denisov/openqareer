import { describe, expect, it } from 'vitest';
import {
  buildParseProgressCounts,
  buildProfileReviewRows,
} from './profileFactReviewRows';
import type { ParsedResumeExperience } from '../workspace/resumeParserTypes';

function experience(
  overrides: Partial<ParsedResumeExperience> = {},
): ParsedResumeExperience {
  return {
    title: 'VP of Technology & Operations',
    employer: 'OptiLab AI',
    startDate: '2025-11',
    current: true,
    responsibilities: ['Вёл переговоры с 12 поставщиками'],
    achievements: ['Сократил издержки на 18%'],
    ...overrides,
  };
}

describe('buildParseProgressCounts', () => {
  it('counts jobs, education entries and bullets carrying a number', () => {
    const counts = buildParseProgressCounts({
      experience: [
        experience({
          responsibilities: ['Вёл переговоры с 12 поставщиками', 'Отвечал за отдел'],
          achievements: ['Сократил издержки на 18%'],
        }),
      ],
      education: [{ institution: 'МГУ' }],
      skills: ['Go', 'SQL'],
    });
    expect(counts.jobCount).toBe(1);
    expect(counts.hasEducation).toBe(true);
    expect(counts.hasSkills).toBe(true);
    expect(counts.totalBullets).toBe(3);
    expect(counts.bulletsWithNumber).toBe(2);
  });

  it('reports zero bullets honestly instead of dividing by zero', () => {
    const counts = buildParseProgressCounts({
      experience: [],
      education: [],
      skills: [],
    });
    expect(counts.totalBullets).toBe(0);
    expect(counts.bulletsWithNumber).toBe(0);
    expect(counts.jobCount).toBe(0);
  });
});

describe('buildProfileReviewRows', () => {
  it('builds one row per job with a numeric-evidence tag and the source label', () => {
    const rows = buildProfileReviewRows({
      experience: [
        experience({
          responsibilities: ['Вёл переговоры', 'Отвечал за бюджет'],
          achievements: ['Нанял 6 человек', 'Запустил проект'],
        }),
      ],
      sourceLabel: 'из резюме',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('VP of Technology & Operations · OptiLab AI');
    expect(rows[0].subtitle).toContain('из резюме');
    expect(rows[0].tag).toEqual({ tone: 'warning', label: '1 из 4 пунктов с числом' });
  });

  it('marks a job success when every bullet already carries a number', () => {
    const rows = buildProfileReviewRows({
      experience: [
        experience({ responsibilities: ['Вырастил команду до 250 человек'], achievements: [] }),
      ],
      sourceLabel: 'из резюме',
    });
    expect(rows[0].tag).toEqual({ tone: 'success', label: 'Результаты в цифрах' });
  });

  it('omits the tag when a job has no bullets to judge', () => {
    const rows = buildProfileReviewRows({
      experience: [experience({ responsibilities: [], achievements: [] })],
      sourceLabel: 'из резюме',
    });
    expect(rows[0].tag).toBeUndefined();
  });

  it('appends a geography row carrying its own source label when given one', () => {
    const rows = buildProfileReviewRows({
      experience: [],
      sourceLabel: 'из резюме',
      geoSummary: 'Дубай, ОАЭ · открыт к удалённой работе и релокации',
      geoSourceLabel: 'из LinkedIn',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Дубай, ОАЭ · открыт к удалённой работе и релокации');
    expect(rows[0].subtitle).toBe('география и формат · из LinkedIn');
    expect(rows[0].tag).toBeUndefined();
  });
});
