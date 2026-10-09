import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from './resumeTypes';
import { profileCompleteness } from './profileCompleteness';

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
  it('counts the eleven visible resume blocks and names only the missing ones', () => {
    expect(profileCompleteness(populatedDraft)).toEqual({
      completedCount: 10,
      totalCount: 11,
      missingSections: ['Курсы'],
    });
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
      totalCount: 11,
      missingSections: [
        'Имя',
        'Контакты',
        'Опыт',
        'Образование',
        'Проекты',
        'Навыки',
        'Языки',
        'Курсы',
        'Сертификаты',
        'Рекомендации',
        'Достижения',
      ],
    });
  });
});
