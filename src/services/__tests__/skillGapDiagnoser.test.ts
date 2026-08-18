import { describe, expect, it } from 'vitest';
import {
  diagnoseSkillGaps,
  generateXyzBulletRecommendation,
} from '../skillGapDiagnoser';
import type { ResumeDraft } from '../../features/resume/resumeTypes';

describe('skillGapDiagnoser', () => {
  const sampleDraft: ResumeDraft = {
    candidate: { fullName: 'Иван Иванов' },
    targetRole: 'Senior Frontend Engineer',
    skills: [{ id: '1', name: 'JavaScript' }, { id: '2', name: 'HTML/CSS' }],
    experience: [
      {
        id: 'exp-1',
        chronologyMemoryId: 'mem-exp-1',
        title: 'Frontend Developer',
        employer: 'Web Studio',
        current: false,
        startDate: '2021-01',
        endDate: '2023-05',
        bulletMemoryIds: ['bullet-1'],
      },
    ],
    education: [],
    languages: [],
  };

  it('diagnoses missing skills against target role standard profile', () => {
    const gaps = diagnoseSkillGaps(sampleDraft, 'Senior Frontend Engineer');

    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some((g) => g.skill.toLowerCase().includes('react') || g.skill.toLowerCase().includes('typescript'))).toBe(true);
    expect(gaps[0].impact).toBeDefined();
    expect(gaps[0].recommendedAction).toBeDefined();
  });

  it('generates Google XYZ formula bullet recommendations for experience bullets', () => {
    const rawBullet = 'Оптимизировал скорость загрузки страниц интернет-магазина.';
    const xyz = generateXyzBulletRecommendation(rawBullet, {
      metric: 'LCP сократился на 42%, конверсия выросла на 15%',
      method: 'внедрения SSR, lazy loading и оптимизации бандла в Webpack/Vite',
    });

    expect(xyz.formattedText).toContain('Оптимизировал');
    expect(xyz.formattedText).toContain('LCP');
    expect(xyz.formattedText).toContain('Vite');
    expect(xyz.standard).toBe('Google XYZ');
  });
});
