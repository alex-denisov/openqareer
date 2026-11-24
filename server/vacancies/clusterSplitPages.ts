import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { normalizeUrl, sourceMemberKey } from './vacancyDeduplicator';

/**
 * B752: чья вакансия стояла на опубликованной странице кластера. Адрес после
 * разбиения ведёт на неё же, поэтому владельца определяет ссылка страницы.
 *
 * Id кластера к другому куску не переходит: `cluster-<запись>` — это сама
 * запись основателя (по нему читаются её текст, снятие и сведение), и её кусок
 * по общему правилу занял бы тот же id. Поэтому уезжает адрес, а не id.
 */

export interface PublishedPage {
  readonly entry_key: string;
  readonly path: string;
  readonly title: string;
  readonly company: string;
  readonly source_url: string;
}

/** Ссылка записи → номера кусков, где эта запись лежит. */
export type LinkOwners = ReadonlyMap<string, ReadonlySet<number>>;

export function linkOwnersOf(
  pieces: readonly VacancyCluster[],
  vacancies: ReadonlyMap<string, UnifiedVacancy>,
): LinkOwners {
  const owners = new Map<string, Set<number>>();
  const add = (link: string | undefined, index: number) => {
    if (!link) return;
    owners.set(link, (owners.get(link) ?? new Set<number>()).add(index));
  };
  pieces.forEach((piece, index) => {
    add(piece.primaryUrl, index);
    for (const source of piece.sources) {
      add(source.sourceUrl, index);
      add(vacancies.get(sourceMemberKey(source) ?? '')?.url, index);
    }
  });
  return owners;
}

/** Общая у нескольких кусков ссылка владельца не называет. */
function single(owners: ReadonlySet<number>): number | undefined {
  return owners.size === 1 ? [...owners][0] : undefined;
}

function ownersAlike(link: string, links: LinkOwners): ReadonlySet<number> {
  const wanted = normalizeUrl(link);
  const found = new Set<number>();
  if (!wanted) return found;
  for (const [known, owners] of links) {
    if (normalizeUrl(known) === wanted) for (const owner of owners) found.add(owner);
  }
  return found;
}

/**
 * Номер куска-владельца страницы (0 — основатель) или `undefined`: вакансии нет
 * ни у одной части. Угадывать кусок нельзя.
 */
export function pageOwner(
  page: PublishedPage,
  pieces: readonly VacancyCluster[],
  links: LinkOwners,
): number | undefined {
  const primary = new Set(
    pieces.flatMap((piece, index) => (piece.primaryUrl === page.source_url ? [index] : [])),
  );
  const byLink =
    single(primary) ??
    single(links.get(page.source_url) ?? primary) ??
    single(ownersAlike(page.source_url, links));
  if (byLink !== undefined) return byLink;
  // Ссылка сменилась или общая, а вакансия у основателя та же: страница его.
  const founder = pieces[0]!;
  return founder.canonicalTitle === page.title && founder.canonicalCompany === page.company
    ? 0
    : undefined;
}

export type PageOutcome = 'kept' | 'redirect' | 'gone' | 'unresolved';

/**
 * Итог для страницы по записанному в базу: свой ключ и адрес, переадресация,
 * снятая (архив или 410). `unresolved` — ни того, ни другого; должно быть 0.
 */
export function recordPageOutcome(
  db: DatabaseSync,
  page: PublishedPage,
  founderId: string,
  stepId: string,
): PageOutcome {
  const redirect = db
    .prepare(
      `SELECT e.path AS path FROM vacancy_catalog_redirects r
         LEFT JOIN catalog_entries e ON e.cluster_id = r.new_cluster_id
        WHERE r.old_key = ? AND r.old_path = ?`,
    )
    .get(page.entry_key, page.path) as { path: string | null } | undefined;
  const held = db
    .prepare('SELECT 1 FROM catalog_entries WHERE entry_key = ? AND cluster_id = ?')
    .get(page.entry_key, founderId);
  const outcome: PageOutcome = redirect
    ? redirect.path
      ? 'redirect'
      : 'gone'
    : held
      ? 'kept'
      : 'unresolved';
  db.prepare(
    'INSERT OR REPLACE INTO cluster_split_pages (old_key, old_path, outcome, step_id) VALUES (?, ?, ?, ?)',
  ).run(page.entry_key, page.path, outcome, stepId);
  return outcome;
}
