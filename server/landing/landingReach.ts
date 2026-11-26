/**
 * B648 (owner, 12.11): the hero feed names the employer and the reach of the
 * catalog instead of the aggregators. Runs in the maintenance reading only.
 *
 * Measured on prod 12.11: distinct companies of the active catalog 4.5 s,
 * active sources from `vacancy_source_state` 0.8 s (a distinct count over the
 * pool index took 40 s, so it is not used), cards of the last day 1 ms.
 */
import type { DatabaseSync } from 'node:sqlite';
import { isNamedEmployer } from '../../shared/employerLabel';
import type { LandingReach } from '../../shared/landingStats';
import { publicEmployerName } from '../../shared/privateEmployer';
import { confirmsLiveness } from '../vacancies/poolLiveness';

const DAY_MS = 86_400_000;

export interface FeedPlaceRow {
  readonly company: string | null;
  readonly location: string | null;
  readonly place_label: string | null;
  readonly is_remote: number;
}

const ANYWHERE = /\b(anywhere|worldwide|global)\b|везде|любой стран/iu;

/** Country names the boards write, in the landing's words. */
const REMOTE_COUNTRIES: Readonly<Record<string, string>> = {
  'united states': 'США',
  usa: 'США',
  us: 'США',
  'united kingdom': 'Великобритания',
  uk: 'Великобритания',
  canada: 'Канада',
  germany: 'Германия',
  netherlands: 'Нидерланды',
  spain: 'Испания',
  france: 'Франция',
  poland: 'Польша',
  portugal: 'Португалия',
  ireland: 'Ирландия',
  india: 'Индия',
  australia: 'Австралия',
  brazil: 'Бразилия',
  mexico: 'Мексика',
  europe: 'Европа',
  emea: 'EMEA',
  latam: 'Латинская Америка',
  apac: 'Азия и Океания',
  россия: 'Россия',
  russia: 'Россия',
};

function firstPart(location: string): string {
  return location.split(/[;,]/u)[0]?.trim() ?? '';
}

/** Where a remote card may be worked from; empty when the board does not say. */
function remoteArea(location: string | null): string {
  if (!location) return '';
  if (ANYWHERE.test(location)) return 'Везде';
  return REMOTE_COUNTRIES[firstPart(location).toLowerCase()] ?? '';
}

/** «Удалённо · США · GitLab», «Офис · Москва · Сбер»; unknown parts are left out. */
export function landingFeedMeta(row: FeedPlaceRow): string {
  const remote = row.is_remote === 1;
  const area = remote
    ? remoteArea(row.location)
    : (row.place_label ?? firstPart(row.location ?? ''));
  const company =
    row.company && isNamedEmployer(row.company) ? publicEmployerName(row.company) : '';
  return [remote ? 'Удалённо' : 'Офис', area, company]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ');
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function countCareerSites(database: DatabaseSync): number {
  if (!tableExists(database, 'vacancy_source_state')) return 0;
  const rows = database
    .prepare('SELECT source_id FROM vacancy_source_state WHERE items_active_total > 0')
    .all() as { source_id: string }[];
  return rows.filter((row) => confirmsLiveness(row.source_id)).length;
}

/** Companies, career sites and new cards; absent until the catalog is projected. */
export function readLandingReach(database: DatabaseSync, now: Date): LandingReach | undefined {
  if (!tableExists(database, 'catalog_entries')) return undefined;
  const catalog = database
    .prepare(
      `SELECT count(DISTINCT company) AS companies,
              (SELECT count(*) FROM catalog_entries
                WHERE status = 'active' AND published_ms > ?) AS fresh
       FROM catalog_entries WHERE status = 'active'`,
    )
    .get(now.getTime() - DAY_MS) as { companies: number; fresh: number };
  return {
    companies: Number(catalog.companies),
    careerSites: countCareerSites(database),
    newToday: Number(catalog.fresh),
  };
}
