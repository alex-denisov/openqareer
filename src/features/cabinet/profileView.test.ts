import { describe, expect, it } from 'vitest';
import type { CandidateSnapshot } from '../coach/coachApi';
import { buildProfileView } from './profileView';

/**
 * Резюме владельца разобрано полностью — 6 мест работы с датами и пунктами,
 * 2 образования, 10 навыков, — а «Главная» показывала плоский список записей
 * памяти и очередь подтверждения (B179). Профиль обязан собираться из
 * разобранного резюме: то, что кандидат сам о себе сообщил, не ждёт
 * отдельного подтверждения, чтобы появиться в его собственном профиле.
 */
function snapshot(): CandidateSnapshot {
  return {
    memory: [
      {
        id: 'imp-ach-2-1',
        kind: 'fact',
        domain: 'outcome',
        statement: 'Grew combined revenue 4x and improved operating margin to ~40%',
        confidence: 'candidate-reported',
        sourceMessageIds: [],
        sensitive: false,
        status: 'proposed',
        createdAt: '2026-09-01T14:00:00.000Z',
        updatedAt: '2026-09-01T14:00:00.000Z',
      },
      {
        id: 'imp-resp-2-1',
        kind: 'fact',
        domain: 'responsibility',
        statement: 'Owned IT, cloud infrastructure and technical operations',
        confidence: 'candidate-reported',
        sourceMessageIds: [],
        sensitive: false,
        status: 'proposed',
        createdAt: '2026-09-01T14:00:00.000Z',
        updatedAt: '2026-09-01T14:00:00.000Z',
      },
    ],
    resume: {
      draft: {
        candidate: {
          fullName: 'Alexey Denisov',
          about: 'I build, scale, and transform technology organizations.',
          contact: { location: 'Dubai, United Arab Emirates' },
        },
        targetRole: 'VP of Technology',
        experience: [
          {
            id: 'exp-2',
            chronologyMemoryId: 'imp-chr-2',
            title: 'VP of Technology & IT Operations',
            employer: 'Enterprise Energy IT Services',
            startDate: '2023-04',
            endDate: '2025-10',
            current: false,
            bulletMemoryIds: ['imp-resp-2-1', 'imp-ach-2-1'],
          },
        ],
        skills: [{ id: 's1', name: 'Executive Leadership' }],
        education: [
          {
            id: 'edu-1',
            evidenceMemoryId: 'edu-1',
            institution: 'Universitatea Tehnică a Moldovei',
            qualification: 'Bachelor of Engineering',
            startDate: '2005',
            endDate: '2010',
          },
        ],
        languages: [{ id: 'l1', evidenceMemoryId: 'l1', name: 'English' }],
      },
      updatedAt: '2026-09-01T14:43:00.000Z',
    },
  } as unknown as CandidateSnapshot;
}

describe('buildProfileView', () => {
  it('называет кандидата так, как он назван в разобранном резюме', () => {
    const view = buildProfileView(snapshot());

    expect(view.fullName).toBe('Alexey Denisov');
    expect(view.targetRole).toBe('VP of Technology');
    expect(view.location).toBe('Dubai, United Arab Emirates');
    expect(view.about).toContain('transform technology organizations');
  });

  it('собирает место работы с периодом, длительностью и пунктами', () => {
    const [job] = buildProfileView(snapshot()).experience;

    expect(job.title).toBe('VP of Technology & IT Operations');
    expect(job.employer).toBe('Enterprise Energy IT Services');
    expect(job.period).toBe('апрель 2023 — октябрь 2025');
    expect(job.duration).toBe('2 г. 7 мес.');
    expect(job.bullets).toHaveLength(2);
    expect(job.bullets[0]).toContain('Owned IT');
  });

  it('считает пункты с числом — результат без величины не достижение', () => {
    const [job] = buildProfileView(snapshot()).experience;

    expect(job.measurableBullets).toBe(1);
    expect(job.bullets).toHaveLength(2);
  });

  it('печатает навыки, образование и языки из резюме', () => {
    const view = buildProfileView(snapshot());

    expect(view.skills).toEqual(['Executive Leadership']);
    expect(view.education[0].institution).toBe('Universitatea Tehnică a Moldovei');
    expect(view.education[0].period).toBe('2005 — 2010');
    expect(view.languages).toEqual(['English']);
  });

  it('пустой снимок не выдумывает профиль', () => {
    const view = buildProfileView(undefined);

    expect(view.fullName).toBeUndefined();
    expect(view.experience).toEqual([]);
    expect(view.skills).toEqual([]);
  });
});
