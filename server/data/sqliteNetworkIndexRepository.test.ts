import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import {
  SqliteNetworkIndexRepository,
  type NetworkObservation,
} from './sqliteNetworkIndexRepository';

const NORTHWIND = candidateCompanyKey('Northwind Labs');
const CONTOSO = candidateCompanyKey('Contoso');

function observation(
  slug: string,
  companyName: string,
  overrides: Partial<NetworkObservation> = {},
): NetworkObservation {
  return {
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    companyName,
    roleTitle: 'Инженер',
    source: 'connections',
    observedAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  };
}

function createRepository() {
  const database = new DatabaseSync(':memory:');
  return { database, repository: new SqliteNetworkIndexRepository(database) };
}

const everyone = () => true;

describe('SqliteNetworkIndexRepository', () => {
  it('keys a person by the canonical profile address, whatever the host or case', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [
      observation('Jane-Roe', 'Northwind Labs', {
        profileUrl: 'https://ru.linkedin.com/in/Jane-Roe?trk=x',
      }),
    ]);
    repository.recordObservations('member-b', [observation('jane-roe', 'Northwind Labs')]);

    expect(repository.countPlatformPaths(NORTHWIND, 'candidate-x', everyone)).toEqual({
      paths: 2,
      members: 2,
    });
    expect(repository.personCount()).toBe(1);
  });

  it('counts paths of other members only and never the candidate own edges', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [
      observation('jane-roe', 'Northwind Labs'),
      observation('john-doe', 'Northwind Labs'),
      observation('mary-major', 'Contoso'),
    ]);
    repository.recordObservations('candidate-b', [observation('john-doe', 'Northwind Labs')]);

    expect(repository.countPlatformPaths(NORTHWIND, 'candidate-b', everyone)).toEqual({
      paths: 2,
      members: 1,
    });
    expect(repository.countPlatformPaths(CONTOSO, 'member-a', everyone)).toEqual({
      paths: 0,
      members: 0,
    });
  });

  it('keeps each member own reading of a person, so no member can move another member path', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [observation('jane-roe', 'Northwind Labs')]);

    repository.recordObservations('member-probe', [
      observation('jane-roe', 'Contoso', { source: 'search' }),
    ]);

    expect(repository.countPlatformPaths(NORTHWIND, 'candidate-b', everyone).paths).toBe(1);
    expect(repository.countPlatformPaths(CONTOSO, 'member-probe', everyone).paths).toBe(0);
  });

  it('leaves out members whose consent is no longer active', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [observation('jane-roe', 'Northwind Labs')]);
    repository.recordObservations('member-c', [observation('john-doe', 'Northwind Labs')]);

    const counted = repository.countPlatformPaths(
      NORTHWIND,
      'candidate-b',
      (memberId) => memberId === 'member-c',
    );

    expect(counted).toEqual({ paths: 1, members: 1 });
    expect(repository.personCount()).toBe(1);
  });

  it('lets a company read by search outrank the headline and never wipes it with an empty one', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [
      observation('jane-roe', 'Contoso', { source: 'search' }),
    ]);
    repository.recordObservations('member-a', [
      observation('jane-roe', 'Northwind Labs', { observedAt: '2026-10-30T10:00:00.000Z' }),
      observation('john-doe', '', { observedAt: '2026-10-30T10:00:00.000Z' }),
    ]);

    expect(repository.countPlatformPaths(CONTOSO, 'candidate-b', everyone).paths).toBe(1);
    expect(repository.countPlatformPaths(NORTHWIND, 'candidate-b', everyone).paths).toBe(0);
  });

  it('replaces a member edges with a full list and drops people nobody links to', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [
      observation('jane-roe', 'Northwind Labs'),
      observation('john-doe', 'Northwind Labs'),
    ]);

    repository.replaceMemberEdges('member-a', [observation('jane-roe', 'Northwind Labs')]);

    expect(repository.countPlatformPaths(NORTHWIND, 'candidate-b', everyone).paths).toBe(1);
    expect(repository.personCount()).toBe(1);
  });

  it('removes every edge of a member on revoke and the people only that member knew', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [
      observation('jane-roe', 'Northwind Labs'),
      observation('john-doe', 'Northwind Labs'),
    ]);
    repository.recordObservations('member-c', [observation('john-doe', 'Northwind Labs')]);

    expect(repository.deleteMemberEdges('member-a')).toBe(2);

    expect(repository.countPlatformPaths(NORTHWIND, 'candidate-b', everyone)).toEqual({
      paths: 1,
      members: 1,
    });
    expect(repository.personCount()).toBe(1);
  });

  it('stops counting and drops an edge nobody confirmed for 90 days', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [
      observation('jane-roe', 'Northwind Labs', { observedAt: '2026-07-01T10:00:00.000Z' }),
    ]);
    repository.recordObservations('member-c', [observation('john-doe', 'Northwind Labs')]);
    const now = new Date('2026-10-29T12:00:00.000Z');

    expect(repository.countPlatformPaths(NORTHWIND, 'candidate-b', everyone, now).paths).toBe(1);
    expect(repository.personCount()).toBe(1);
  });

  it('keeps no edge for a contact whose company is unknown', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [observation('jane-roe', '')]);

    expect(repository.personCount()).toBe(0);
  });

  it('forgets a person for every member when that person objects', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [observation('jane-roe', 'Northwind Labs')]);
    repository.recordObservations('member-c', [observation('Jane-Roe', 'Northwind Labs')]);

    expect(repository.deletePerson('https://ru.linkedin.com/in/jane-roe')).toBe(2);

    expect(repository.countPlatformPaths(NORTHWIND, 'candidate-b', everyone).paths).toBe(0);
    expect(repository.personCount()).toBe(0);
  });

  it('ignores addresses that are not a LinkedIn person profile', () => {
    const { repository } = createRepository();
    repository.recordObservations('member-a', [
      observation('x', 'Northwind Labs', { profileUrl: 'https://www.linkedin.com/company/x/' }),
      observation('y', 'Northwind Labs', { profileUrl: 'https://example.com/in/y/' }),
    ]);

    expect(repository.personCount()).toBe(0);
  });
});
