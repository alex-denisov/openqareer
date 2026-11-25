import { describe, expect, it } from 'vitest';
import type { HhResumeSnapshot } from '../../shared/hhCandidateSession';
import { reviewHhResumes } from './hhResumeReview';

const snapshot: HhResumeSnapshot = {
  resumes: [
    { id: 'lead', title: 'Руководитель разработки' },
    { id: 'go', title: 'Ведущий разработчик Go' },
    { id: 'old', title: 'Системный администратор' },
  ],
  selected: { id: 'go', title: 'Ведущий разработчик Go', text: 'Go, PostgreSQL. Писала сервисы платежей.' },
  contents: [
    {
      id: 'lead',
      title: 'Руководитель разработки',
      text: 'Руководила командой из 9 человек. Kubernetes, Go, PostgreSQL. Наём и развитие команды.',
    },
  ],
  readAt: '2026-11-19T01:00:00.000Z',
};

describe('B678: сверка резюме hh.ru с вакансией', () => {
  it('у прочитанного резюме — что из требований есть и чего не хватает; непрочитанное так и названо', () => {
    const review = reviewHhResumes(snapshot, ['Kubernetes', 'Go', 'PostgreSQL']);

    expect(review.resumes).toEqual([
      { resumeId: 'lead', title: 'Руководитель разработки', status: 'fits', matched: ['Kubernetes', 'Go', 'PostgreSQL'], missing: [] },
      { resumeId: 'go', title: 'Ведущий разработчик Go', status: 'gaps', matched: ['Go', 'PostgreSQL'], missing: ['Kubernetes'] },
      { resumeId: 'old', title: 'Системный администратор', status: 'unread', matched: [], missing: [] },
    ]);
    expect(review.recommendedId).toBe('lead');
  });

  it('требование ищется целым словом без учёта регистра: «Go» не находится в «Google»', () => {
    const review = reviewHhResumes(
      { ...snapshot, selected: { id: 'go', title: 'Аналитик', text: 'Работала в Google, знаю SQL.' }, contents: [] },
      ['go', 'sql'],
    );
    expect(review.resumes.find((item) => item.resumeId === 'go')).toMatchObject({ matched: ['sql'], missing: ['go'] });
  });

  it('при равенстве рекомендуется резюме, которым кандидат уже откликается', () => {
    const review = reviewHhResumes(
      { ...snapshot, contents: [{ id: 'lead', title: 'Руководитель разработки', text: 'Go и PostgreSQL.' }] },
      ['Go', 'PostgreSQL'],
    );
    expect(review.recommendedId).toBe('go');
  });

  it('без требований каждое прочитанное подходит, рекомендовано выбранное; без чтений рекомендации нет', () => {
    expect(reviewHhResumes(snapshot, []).recommendedId).toBe('go');
    expect(reviewHhResumes(snapshot, []).resumes.map((item) => item.status)).toEqual(['fits', 'fits', 'unread']);
    expect(reviewHhResumes({ ...snapshot, selected: null, contents: [] }, ['Go']).recommendedId).toBeNull();
  });

  it('повторы и пустые требования не считаются дважды', () => {
    const review = reviewHhResumes(snapshot, [' Go ', 'go', '', 'Kubernetes']);
    expect(review.requirements).toEqual(['Go', 'Kubernetes']);
  });

  it('подходящее по роли важнее выбранного прежде, даже непрочитанное', () => {
    const roles: Readonly<Record<string, 0 | 1>> = { 'IT Директор / CIO / CTO': 1 };
    const cio = { id: 'cio', title: 'IT Директор / CIO / CTO' };
    const coo = { id: 'coo', title: 'COO' };
    const review = reviewHhResumes(
      { resumes: [coo, cio], selected: { ...coo, text: 'DevOps' }, readAt: 'x' },
      ['DevOps'],
      (title) => ({ role: roles[title] ?? 0, words: 0 }),
    );
    expect(review.recommendedId).toBe('cio');
  });
});
