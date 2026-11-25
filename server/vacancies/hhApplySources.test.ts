import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { preferredApplySource } from '../../shared/hhVacancySource';
import { withOwnHhSources } from './hhApplySources';
import { createClusterFromVacancy } from './vacancyDeduplicator';
import { resolveVacancyApplyTarget } from './vacancyApplyTarget';

function posting(
  sourceId: string,
  externalId: string,
  url: string,
  part: Partial<UnifiedVacancy>,
): UnifiedVacancy {
  return {
    id: `${sourceId}:${externalId}`,
    fingerprint: externalId,
    title: 'Финансовый аналитик',
    company: 'Acme',
    location: 'Москва',
    isRemote: false,
    description: 'Описание',
    requiredSkills: [],
    url,
    provenance: { sourceType: 'json_api', sourceId, externalId, sourceUrl: url, observedAt: '' },
    publishedAt: '2026-11-22T00:00:00.000Z',
    status: 'active',
    ...part,
  };
}
const GETMATCH_URL = 'https://getmatch.ru/vacancies/34995';
const getmatch = (part: Partial<UnifiedVacancy> = {}) =>
  posting('src-fh-getmatch', '34995', GETMATCH_URL, part);
const hh = (part: Partial<UnifiedVacancy> = {}) =>
  posting('src-hh-search', '138522719', 'https://hh.ru/vacancy/138522719', part);

function route(own: UnifiedVacancy, other: UnifiedVacancy, known = true) {
  const cluster = {
    ...createClusterFromVacancy(own),
    sources: [own.provenance, other.provenance],
  };
  const read = (id: string) => [own, ...(known ? [other] : [])].find((item) => item.id === id);
  const result = withOwnHhSources(cluster, read);
  return {
    ...preferredApplySource(result),
    target: resolveVacancyApplyTarget({ getVacancy: read }, result)?.url,
  };
}

describe('B787: hh.ru — площадка отклика только у той же вакансии', () => {
  it('те же компания, должность и место — hh.ru', () => {
    expect(route(getmatch(), hh({ location: 'Москва (м. Технопарк), Россия' })).hh).toBe(true);
    const remote = { isRemote: true, location: 'Весь мир' };
    expect(route(getmatch(remote), hh({ isRemote: true })).hh).toBe(true);
  });

  it.each<[string, UnifiedVacancy, UnifiedVacancy]>([
    ['другая должность', getmatch(), hh({ title: 'Системный аналитик' })],
    ['название-продолжение', getmatch(), hh({ title: 'Финансовый аналитик SQL' })],
    ['другое место', getmatch(), hh({ location: 'Минск' })],
    ['место не названо у одной', getmatch(), hh({ location: undefined })],
    ['удалённая только одна', getmatch({ isRemote: true, location: 'Весь мир' }), hh()],
    ['другая компания', getmatch(), hh({ company: 'Beta' })],
    ['снята', getmatch(), hh({ status: 'archived' })],
  ])('%s — собственная запись карточки', (_, own, other) => {
    expect(route(own, other)).toMatchObject({ hh: false, url: GETMATCH_URL, target: GETMATCH_URL });
  });

  it('записи hh.ru в пуле нет — сверить нечем', () => {
    expect(route(getmatch(), hh(), false).hh).toBe(false);
  });

  it('строка hh.ru остаётся на hh.ru', () => {
    expect(route(hh(), getmatch({ location: 'Минск' }))).toMatchObject({
      hh: true,
      url: 'https://hh.ru/vacancy/138522719',
    });
  });
});
