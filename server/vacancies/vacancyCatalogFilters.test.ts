import { describe, expect, it } from 'vitest';
import { catalogFilterGroups } from './vacancyCatalogFilters';
import type { CatalogEntry } from './vacancyCatalogPage';

/**
 * Фильтры каталога — это ссылки, а не виджет (B209, срез 2b).
 *
 * Каталог собирается на сервере и живёт вне приложения: скрипта на странице
 * нет вовсе. Значит, сузить выборку читатель может только переходом, и тот же
 * переход — единственный способ краулера дойти до списка. Фильтр, сделанный
 * скриптом, не увидели бы ни поисковик, ни читатель без JavaScript.
 */
let uniqueKey = 0;

function entry(title: string, location: string | undefined, isRemote: boolean): CatalogEntry {
  uniqueKey += 1;
  return {
    key: `запись-${uniqueKey}`,
    path: '/vacancies/job/x',
    title,
    company: 'Компания',
    location,
    isRemote,
    summary: 'Описание',
    skills: [],
    sourceUrl: 'https://example.test/1',
    publishedAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-08T00:00:00.000Z',
  } as unknown as CatalogEntry;
}

/** Порог публикации — три вакансии, поэтому каждый список строится тройками. */
function times(count: number, make: (index: number) => CatalogEntry): CatalogEntry[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

const entries: CatalogEntry[] = [
  // Уровень в заголовке роль не меняет: «Senior Frontend Developer» и
  // «Frontend Developer» — один список (см. `vacancyCatalogFacets`).
  ...times(4, (i) =>
    entry(i === 0 ? 'Senior Frontend Developer' : 'Frontend Developer', 'Berlin, Germany', false),
  ),
  ...times(3, () => entry('Data Analyst', 'Berlin, Germany', false)),
  ...times(3, () => entry('Frontend Developer', 'Amsterdam, Netherlands', false)),
  ...times(5, () => entry('Frontend Developer', undefined, true)),
  // Одна вакансия в Лиссабоне: порог не пройден, страницы быть не должно.
  entry('Frontend Developer', 'Lisbon, Portugal', false),
];

describe('catalogFilterGroups', () => {
  it('в корне каталога отдельно называет места и отдельно роли', () => {
    const groups = catalogFilterGroups(entries);
    const places = groups.find((group) => group.kind === 'places');
    const roles = groups.find((group) => group.kind === 'roles');

    expect(places?.links.map((link) => link.path)).toEqual(
      expect.arrayContaining(['/vacancies/berlin', '/vacancies/amsterdam', '/vacancies/remote']),
    );
    expect(places?.links.every((link) => link.path.split('/').length === 3)).toBe(true);
    expect(roles?.links.every((link) => link.path.split('/').length === 4)).toBe(true);
  });

  it('не публикует место, не прошедшее порог', () => {
    const paths = catalogFilterGroups(entries).flatMap((group) =>
      group.links.map((link) => link.path),
    );
    expect(paths).not.toContain('/vacancies/lisbon');
  });

  it('на странице места предлагает роли этого места и не ссылается на само место', () => {
    const groups = catalogFilterGroups(entries, { place: 'berlin' });
    const roles = groups.find((group) => group.kind === 'roles');

    expect(roles?.links.map((link) => link.path)).toEqual(
      expect.arrayContaining(['/vacancies/berlin/frontend-developer']),
    );
    expect(roles?.links.every((link) => link.path.startsWith('/vacancies/berlin/'))).toBe(true);
    const all = groups.flatMap((group) => group.links.map((link) => link.path));
    expect(all).not.toContain('/vacancies/berlin');
  });

  it('на странице роли предлагает ту же роль в других местах', () => {
    const groups = catalogFilterGroups(entries, { place: 'berlin', role: 'frontend-developer' });
    const sameRole = groups.find((group) => group.kind === 'same-role');

    expect(sameRole?.links.map((link) => link.path)).toEqual(
      expect.arrayContaining([
        '/vacancies/amsterdam/frontend-developer',
        '/vacancies/remote/frontend-developer',
      ]),
    );
    // Ссылка на саму себя фильтром не является.
    expect(sameRole?.links.map((link) => link.path)).not.toContain(
      '/vacancies/berlin/frontend-developer',
    );
  });

  it('пустая группа не появляется вовсе — заголовка без ссылок не бывает', () => {
    const groups = catalogFilterGroups([]);
    expect(groups).toEqual([]);
    expect(catalogFilterGroups(entries).every((group) => group.links.length > 0)).toBe(true);
  });

  it('каждая ссылка несёт свой счёт, а не общий', () => {
    const groups = catalogFilterGroups(entries);
    const berlin = groups
      .flatMap((group) => group.links)
      .find((link) => link.path === '/vacancies/berlin');
    expect(berlin?.count).toBe(7);
  });
});
