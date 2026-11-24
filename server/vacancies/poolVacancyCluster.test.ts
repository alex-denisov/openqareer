import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { resolveRowVacancyCluster } from './poolVacancyCluster';
import { createClusterFromVacancy } from './vacancyDeduplicator';

function vacancy(id: string, title: string, salary: UnifiedVacancy['salary']): UnifiedVacancy {
  return {
    id,
    fingerprint: `fp-${id}`,
    title,
    company: 'Arootah',
    description: 'Описание',
    requiredSkills: [],
    url: `https://jobs.example/${id}`,
    provenance: {
      sourceType: 'direct',
      sourceId: 'ats-lever-arootah',
      sourceUrl: '',
      observedAt: '',
    },
    publishedAt: '2026-11-22T00:00:00.000Z',
    status: 'active',
    ...(salary ? { salary } : {}),
  };
}

const OWN = vacancy('ats-lever-arootah:8faace0f', 'Fractional Chief AI Officer', {
  from: 275,
  to: 425,
  currency: 'USD',
  period: 'hour',
});
const FOUNDER = vacancy('src-himalayas-api:cao', 'Fractional Chief Administrative Officer', {
  from: 200,
  to: 300,
  currency: 'USD',
  period: 'hour',
});
// Сохранённый кластер склеен вокруг другой вакансии; строка подборки — его участник.
const MERGED: VacancyCluster = { ...createClusterFromVacancy(FOUNDER), vacanciesCount: 15 };

function engine(active: Record<string, VacancyCluster>, records: readonly UnifiedVacancy[]) {
  return {
    getActiveCluster: (id: string) => active[id],
    getVacancy: (id: string) => records.find((record) => record.id === id),
  };
}

describe('resolveRowVacancyCluster: карточка читает ту же вакансию, что строка подборки (B765, B645 23.11)', () => {
  it('строка-участник склеенного кластера — своя запись, а не основатель', () => {
    const rowId = `cluster-${OWN.id}`;
    const cluster = resolveRowVacancyCluster(engine({ [rowId]: MERGED }, [OWN, FOUNDER]), rowId);
    expect(cluster?.id).toBe(rowId);
    expect(cluster?.canonicalTitle).toBe('Fractional Chief AI Officer');
    expect(cluster?.salary).toMatchObject({ from: 275, to: 425, period: 'hour' });
  });

  it('свой сохранённый кластер и снятая запись — как прежде', () => {
    const own = createClusterFromVacancy(OWN);
    expect(resolveRowVacancyCluster(engine({ [own.id]: own }, []), own.id)).toBe(own);
    const gone = { ...OWN, status: 'archived' as const };
    expect(resolveRowVacancyCluster(engine({ [own.id]: MERGED }, [gone]), own.id)).toBe(MERGED);
    expect(resolveRowVacancyCluster(engine({}, []), own.id)).toBeUndefined();
  });
});

/** Прод 24.11: сохранённый кластер «Receptionist» склеил ЭР-Телеком с чужими вакансиями hh.ru. */
function posting(
  sourceId: string,
  externalId: string,
  title: string,
  company: string,
  url: string,
): UnifiedVacancy {
  const id = `${sourceId}:${externalId}`;
  return {
    ...vacancy(id, title, undefined),
    fingerprint: id,
    company,
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceName: sourceId === 'src-fh-getmatch' ? 'Getmatch' : 'hh.ru (страница поиска)',
      sourceUrl: url,
      externalId,
      observedAt: '2026-11-06T19:58:42.314Z',
    },
  };
}

describe('resolveRowVacancyCluster: площадки строки (B678)', () => {
  const getmatch = posting(
    'src-fh-getmatch',
    '37138',
    'Руководитель IT-инфраструктуры / Начальник IT-отдела / Head of DevOps',
    'ЭР-Телеком Холдинг',
    'https://getmatch.ru/vacancies/37138-rukovoditel-it-infrastruktury-nachalnik-it-otdela',
  );
  const hh = posting(
    'src-hh-search',
    '139105692',
    'Руководитель IT-инфраструктуры/Начальник IT-отдела/Head of DevOps',
    'ЭР-Телеком Холдинг',
    'https://hh.ru/vacancy/139105692',
  );
  const alien = posting(
    'src-hh-search',
    '138071222',
    'Receptionist',
    'Group 1 Automotive, Inc.',
    'https://hh.ru/vacancy/138071222',
  );
  const glued = (...members: readonly UnifiedVacancy[]): VacancyCluster => ({
    ...createClusterFromVacancy(members[0]!),
    sources: members.map((item) => item.provenance),
  });
  const rowId = `cluster-${getmatch.id}`;
  const urls = (stored: VacancyCluster) =>
    resolveRowVacancyCluster(
      engine({ [rowId]: stored }, [getmatch, hh, alien]),
      rowId,
    )?.sources.map((source) => source.sourceUrl);

  it('hh.ru той же вакансии остаётся, чужая вакансия склейки отпадает', () => {
    expect(urls(glued(alien, hh, getmatch))).toEqual([getmatch.url, hh.url]);
  });

  it('своя строка-основатель не берёт чужую площадку склейки', () => {
    expect(urls(glued(getmatch, alien))).toEqual([getmatch.url]);
    expect(urls(glued(getmatch, hh))).toEqual([getmatch.url, hh.url]);
  });
});
