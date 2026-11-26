import { describe, expect, it } from 'vitest';
import type { StoredResumeVersion } from './resumeVersions';
import { latestPerVacancy } from './resumeVersionsPerVacancy';

const version = (id: string, patch: Partial<StoredResumeVersion> = {}): StoredResumeVersion => ({
  id,
  title: 'CTO',
  requirements: ['SQL'],
  status: 'approved',
  snapshot: {} as StoredResumeVersion['snapshot'],
  revision: 2,
  sourceMasterRevision: 'm',
  createdAt: '2026-11-25T10:00:00Z',
  updatedAt: '2026-11-25T10:00:00Z',
  ...patch,
});
const ids = (list: readonly StoredResumeVersion[]) => latestPerVacancy(list).map(({ id }) => id);

describe('latestPerVacancy (B801)', () => {
  it('оставляет последнюю версию вакансии', () => {
    expect(ids([version('new', { vacancyId: 'v1' }), version('old', { vacancyId: 'v1' })])).toEqual(
      ['new'],
    );
  });

  it('не сводит две вакансии с одинаковым названием', () => {
    expect(ids([version('a', { vacancyId: 'v1' }), version('b', { vacancyId: 'v2' })])).toEqual([
      'a',
      'b',
    ]);
  });

  it('прежние версии без вакансии сводит по названию и требованиям', () => {
    expect(
      ids([
        version('new', { vacancyId: 'v1' }),
        version('legacy'),
        version('other', { requirements: ['Go'] }),
      ]),
    ).toEqual(['new', 'other']);
  });

  it('отправленные и черновики не прячет', () => {
    expect(
      ids([version('a'), version('s', { status: 'sent' }), version('d', { status: 'draft' })]),
    ).toEqual(['a', 's', 'd']);
  });
});
