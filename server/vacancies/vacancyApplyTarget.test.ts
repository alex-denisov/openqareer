import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { resolveRowVacancyCluster } from './poolVacancyCluster';
import { resolveVacancyApplyTarget } from './vacancyApplyTarget';
import { createClusterFromVacancy } from './vacancyDeduplicator';

function posting(uuid: string, title: string, location: string): UnifiedVacancy {
  return {
    id: `ats-lever-acme:${uuid}`,
    fingerprint: uuid,
    title,
    company: 'Acme',
    location,
    description: 'Описание',
    requiredSkills: [],
    url: `https://jobs.lever.co/acme/${uuid}`,
    provenance: {
      sourceType: 'direct',
      sourceId: 'ats-lever-acme',
      externalId: uuid,
      sourceUrl: `https://jobs.lever.co/acme/${uuid}`,
      observedAt: '2026-11-24T00:00:00.000Z',
    },
    publishedAt: '2026-11-22T00:00:00.000Z',
    status: 'active',
  };
}

const uuid = (digit: number) => `${digit}`.repeat(8) + '-1111-4111-8111-111111111111';
const COMPLIANCE = posting(uuid(1), 'Fractional Chief Compliance Officer', 'Remote');
const ADMIN = posting(uuid(2), 'Fractional Chief Administrative Officer', 'Remote');
const US = posting(uuid(3), 'Director of Platform', 'US - East Coast');
const EUROPE = posting(uuid(4), 'Director of Platform', 'Europe');

function engine(records: readonly UnifiedVacancy[], stored?: VacancyCluster) {
  return {
    getActiveCluster: (id: string) => (stored?.id === id ? stored : undefined),
    getVacancy: (id: string) => records.find((record) => record.id === id),
  };
}

function merged(founder: UnifiedVacancy, shown: UnifiedVacancy): VacancyCluster {
  return {
    ...createClusterFromVacancy(founder),
    canonicalTitle: shown.title,
    canonicalLocation: shown.location,
    sources: [founder.provenance, shown.provenance],
    vacanciesCount: 2,
  };
}

describe('отклик ведёт на вакансию, чьи название и место показаны (B787)', () => {
  it('основатель склейки — другая роль: цель — участник с названием карточки', () => {
    const target = resolveVacancyApplyTarget(
      engine([COMPLIANCE, ADMIN]),
      merged(COMPLIANCE, ADMIN),
    );
    expect(target?.url).toBe(ADMIN.url);
  });

  it('основатель с тем же названием, но в другом месте: цель — участник с местом карточки', () => {
    const target = resolveVacancyApplyTarget(engine([US, EUROPE]), merged(US, EUROPE));
    expect(target?.url).toBe(EUROPE.url);
  });

  it('основатель снят: цель — участник карточки, а не адрес склейки', () => {
    const cluster = merged(US, EUROPE);
    expect(resolveVacancyApplyTarget(engine([EUROPE]), cluster)?.url).toBe(EUROPE.url);
  });

  it('строка подборки с чужим местом в склейке: карточка и цель — сама запись', () => {
    const stored = merged(US, EUROPE);
    const row = resolveRowVacancyCluster(engine([US, EUROPE], stored), stored.id);
    expect(row?.canonicalLocation).toBe('US - East Coast');
    expect(resolveVacancyApplyTarget(engine([US, EUROPE]), row!)?.url).toBe(US.url);
  });
});
