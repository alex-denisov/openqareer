import { describe, expect, it } from 'vitest';
import { builderResumeSchema } from '../../../../shared/resumeBuilder/model';
import type { ResumeStudioView } from '../../resume/resumeTypes';
import { roleResumeFromProfile } from './roleResume';

const view = {
  draft: {
    candidate: {
      fullName: 'Мария Соколова',
      contact: { email: 'm@example.test', phone: '+7 900 000-00-00', location: 'Москва' },
    },
    experience: [
      {
        id: 'e1',
        chronologyMemoryId: 'm0',
        title: 'Руководитель разработки',
        employer: 'Финтех Лаб',
        startDate: '2021-03',
        current: true,
        bulletMemoryIds: ['m1', 'missing'],
      },
    ],
    education: [{ id: 'ed', evidenceMemoryId: 'm2', institution: 'МГТУ', endDate: '2012-06' }],
    languages: [],
    skills: [
      { id: 's1', name: 'Kubernetes' },
      { id: 's2', name: 'Go' },
    ],
  },
  projection: {
    evidenceSnapshot: [{ memoryId: 'm1', statement: 'Команда выросла с 4 до 9 человек' }],
  },
} as unknown as ResumeStudioView;

describe('s01: резюме под роль из профиля', () => {
  it('поля профиля и результаты места работы — в файл резюме, роль — заголовком', () => {
    const resume = roleResumeFromProfile(view, 'Директор по разработке');
    expect(resume).toMatchObject({
      fullName: 'Мария Соколова',
      title: 'Директор по разработке',
      city: 'Москва',
      email: 'm@example.test',
      skills: 'Kubernetes, Go',
      jobs: [
        {
          company: 'Финтех Лаб',
          role: 'Руководитель разработки',
          start: '03.2021',
          end: '',
          current: true,
          bullets: ['Команда выросла с 4 до 9 человек'],
        },
      ],
      education: [{ school: 'МГТУ', degree: '', year: '2012' }],
    });
    expect(builderResumeSchema.safeParse(resume).success).toBe(true);
  });

  it('длинные поля обрезаются до пределов файла, а не ломают сборку', () => {
    const long = { ...view, draft: { ...view.draft!, candidate: { fullName: 'Я'.repeat(500) } } };
    const resume = roleResumeFromProfile(long as ResumeStudioView, 'Роль'.repeat(100));
    expect(builderResumeSchema.safeParse(resume).success).toBe(true);
  });

  it('профиля нет — файла нет', () => {
    expect(roleResumeFromProfile({ draft: null } as unknown as ResumeStudioView, 'X')).toBeNull();
  });
});
