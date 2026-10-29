import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from './resumeTypes';
import { hasAchievements, profileCompleteness } from './profileCompleteness';

const populatedDraft: ResumeDraft = {
  candidate: {
    fullName: 'Марина Соколова',
    headline: 'VP of Engineering',
    contact: { email: 'marina@example.com' },
  },
  experience: [
    {
      id: 'experience-1',
      chronologyMemoryId: 'memory-1',
      title: 'VP of Engineering',
      employer: 'FinNova Bank',
      startDate: '2021-01-01',
      current: true,
      bulletMemoryIds: ['memory-2'],
    },
  ],
  education: [{ id: 'education-1', evidenceMemoryId: 'memory-3', institution: 'TUM' }],
  projects: [{ id: 'project-1', name: 'Payments migration' }],
  skills: [{ id: 'skill-1', name: 'Kubernetes' }],
  languages: [{ id: 'language-1', evidenceMemoryId: 'memory-4', name: 'Английский', cefr: 'C1' }],
  courses: [],
  certifications: [{ id: 'certificate-1', name: 'CKA' }],
  recommendations: [{ id: 'recommendation-1', text: 'Trusted leader' }],
  achievements: [{ id: 'achievement-1', kind: 'publication', title: 'Platform paper' }],
};

describe('profileCompleteness', () => {
  it('counts only the six required blocks; optional ones are never a gap', () => {
    expect(profileCompleteness(populatedDraft)).toEqual({
      completedCount: 6,
      totalCount: 6,
      missingSections: [],
    });
    const bare: ResumeDraft = {
      ...populatedDraft,
      projects: [],
      courses: [],
      certifications: [],
      recommendations: [],
      achievements: [],
    };
    expect(profileCompleteness(bare).missingSections).toEqual([]);
  });

  it('treats achievements as present when workplace bullets exist', () => {
    const noAchievements: ResumeDraft = { ...populatedDraft, achievements: [] };
    expect(hasAchievements(noAchievements)).toBe(true);
    const noBullets: ResumeDraft = {
      ...noAchievements,
      experience: [{ ...populatedDraft.experience[0]!, bulletMemoryIds: [] }],
    };
    expect(hasAchievements(noBullets)).toBe(false);
  });

  it('requires a way to contact the candidate rather than only a city', () => {
    expect(
      profileCompleteness({
        ...populatedDraft,
        candidate: { ...populatedDraft.candidate, contact: { location: 'Москва', links: [] } },
      }).missingSections,
    ).toContain('Контакты');
    expect(
      profileCompleteness({
        ...populatedDraft,
        candidate: { ...populatedDraft.candidate, contact: { phone: '+7 000 000-00-00' } },
      }).missingSections,
    ).not.toContain('Контакты');
  });

  it('counts missing experience dates as an incomplete profile block', () => {
    const experience = populatedDraft.experience[0]!;
    const missingStartDate = profileCompleteness({
      ...populatedDraft,
      experience: [{ ...experience, startDate: undefined }],
    });
    const missingEndDate = profileCompleteness({
      ...populatedDraft,
      experience: [{ ...experience, current: false, endDate: undefined }],
    });

    expect(missingStartDate.missingSections).toContain('Опыт');
    expect(missingEndDate.missingSections).toContain('Опыт');
  });

  it('treats empty and absent optional arrays as incomplete without inventing values', () => {
    const emptyDraft: ResumeDraft = {
      candidate: {},
      experience: [],
      education: [],
      languages: [],
    };

    expect(profileCompleteness(emptyDraft)).toEqual({
      completedCount: 0,
      totalCount: 6,
      missingSections: ['Имя', 'Контакты', 'Опыт', 'Образование', 'Навыки', 'Языки'],
    });
  });
});
