import type {
  B640Contact,
  B640ContactFacets,
  B640ContactLink,
  B640ContactList,
  B640ContactSort,
  B640ContactState,
} from '../../shared/b640Contacts';
import { candidateCompanyKey, type ConnectionCircleWorkplace } from './candidateCompanies';
import { hiringRank } from './contactHiringRole';

/** Контакт кандидата в том виде, что читает список: без почты и телефона. */
export interface B640ContactSource {
  readonly id: string;
  readonly fullName: string;
  readonly roleTitle: string;
  readonly companyName: string;
  readonly source: 'manual' | 'linkedin_import';
  readonly relationship: string;
  readonly workplaces: readonly ConnectionCircleWorkplace[];
  readonly knowsRecruiterIds: readonly string[];
  readonly updatedAt: string;
}

export interface B640ContactQuery {
  readonly offset: number;
  readonly limit: number;
  readonly search: string;
  readonly company: readonly string[];
  readonly link: readonly B640ContactLink[];
  readonly status: readonly B640ContactState[];
  readonly sort: B640ContactSort;
}

export interface B640ContactListInput {
  readonly contacts: readonly B640ContactSource[];
  readonly candidateWorkplaces: readonly ConnectionCircleWorkplace[];
  readonly statuses: ReadonlyMap<string, { readonly state: B640ContactState; readonly at: string }>;
  /** Ключи компаний текущей подборки (`candidateCompanyKey`). */
  readonly selectionKeys: ReadonlySet<string>;
  readonly linkedinImport?: B640ContactList['linkedinImport'];
}

type Row = B640Contact & { readonly updatedAt: string; readonly rank: 0 | 1 };

/** What the old import routes write as `relationship` when the file says nothing: it is not a path (B645). */
const IMPORT_PLACEHOLDER = 'Контакт из импортированного списка LinkedIn';

const year = (value: string | null | undefined): string | null => /^\d{4}/u.exec(value ?? '')?.[0] ?? null;

function years(start: string | null | undefined, end: string | null | undefined): string {
  const from = year(start);
  const to = year(end);
  if (from && to) return from === to ? from : `${from}–${to}`;
  return from ? `с ${from}` : '';
}

function sharedWorkplaceNote(
  contact: B640ContactSource,
  own: ReadonlyMap<string, ConnectionCircleWorkplace>,
): string | null {
  const places = [...contact.workplaces, ...(contact.companyName ? [{ companyName: contact.companyName }] : [])];
  for (const place of places) {
    const mine = own.get(candidateCompanyKey(place.companyName));
    if (!mine) continue;
    const dates = 'startDate' in place && place.startDate ? place : mine;
    const when = years(dates.startDate, dates.endDate);
    return `работали вместе в «${place.companyName}»${when ? `, ${when}` : ''}`;
  }
  return null;
}

function linkOf(
  contact: B640ContactSource,
  own: ReadonlyMap<string, ConnectionCircleWorkplace>,
  introducers: ReadonlyMap<string, string>,
): Pick<B640Contact, 'link' | 'linkNote'> {
  const shared = sharedWorkplaceNote(contact, own);
  if (shared) return { link: 'direct', linkNote: shared };
  const relationship = contact.relationship.trim();
  if (contact.source === 'manual' && relationship && relationship !== IMPORT_PLACEHOLDER) {
    return { link: 'direct', linkNote: relationship };
  }
  const through = introducers.get(contact.id);
  if (through) return { link: 'intro', linkNote: `общий знакомый: ${through}` };
  return { link: 'none', linkNote: null };
}

/** Кто из контактов кандидата знает данного человека: id → имя первого такого. */
function introducersOf(contacts: readonly B640ContactSource[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const via of contacts) {
    for (const knownId of via.knowsRecruiterIds) {
      if (knownId !== via.id && !result.has(knownId)) result.set(knownId, via.fullName);
    }
  }
  return result;
}

function toRows(input: B640ContactListInput): Row[] {
  const own = new Map(input.candidateWorkplaces.map((place) => [candidateCompanyKey(place.companyName), place]));
  const introducers = introducersOf(input.contacts);
  // B645: the screen is «люди, которые нанимают»; the others still count as introducers above.
  return input.contacts.flatMap((contact) => {
    const rank = hiringRank(contact.roleTitle);
    if (rank === null) return [];
    const stored = input.statuses.get(contact.id);
    return [{
      id: contact.id,
      fullName: contact.fullName,
      roleTitle: contact.roleTitle,
      companyName: contact.companyName,
      ...linkOf(contact, own, introducers),
      status: stored ? { state: stored.state, at: stored.at } : { state: 'none', at: null },
      inSelection: contact.companyName !== '' && input.selectionKeys.has(candidateCompanyKey(contact.companyName)),
      updatedAt: contact.updatedAt,
      rank,
    }];
  });
}

const fold = (value: string): string => value.toLocaleLowerCase('ru-RU');
const byName = (a: Row, b: Row): number =>
  a.fullName.localeCompare(b.fullName, 'ru-RU') || a.id.localeCompare(b.id);

const SORTS: Readonly<Record<B640ContactSort, (a: Row, b: Row) => number>> = {
  name: byName,
  selection: (a, b) =>
    Number(b.inSelection) - Number(a.inSelection) ||
    a.companyName.localeCompare(b.companyName, 'ru-RU') ||
    a.rank - b.rank ||
    byName(a, b),
  recent: (a, b) =>
    (b.status.at ?? '').localeCompare(a.status.at ?? '') ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    byName(a, b),
};

function facetsOf(rows: readonly Row[]): B640ContactFacets {
  const companies = new Map<string, number>();
  const link = { direct: 0, intro: 0, none: 0 };
  const status = { none: 0, written: 0, replied: 0 };
  for (const row of rows) {
    if (row.companyName) companies.set(row.companyName, (companies.get(row.companyName) ?? 0) + 1);
    link[row.link] += 1;
    status[row.status.state] += 1;
  }
  return {
    companies: [...companies].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'ru-RU')),
    link,
    status,
  };
}

const wanted = <T>(selected: readonly T[], value: T): boolean => selected.length === 0 || selected.includes(value);

/** Поиск, фасеты по всему найденному, фильтры, сортировка и страница — одним проходом по контактам. */
export function buildB640ContactList(input: B640ContactListInput, query: B640ContactQuery): B640ContactList {
  const needle = fold(query.search.trim());
  const searched = toRows(input).filter(
    (row) => !needle || [row.fullName, row.companyName, row.roleTitle].some((text) => fold(text).includes(needle)),
  );
  const filtered = searched
    .filter(
      (row) =>
        wanted(query.company, row.companyName) && wanted(query.link, row.link) && wanted(query.status, row.status.state),
    )
    .sort(SORTS[query.sort]);
  const page = filtered.slice(query.offset, query.offset + query.limit);
  const shown = query.offset + page.length;
  return {
    items: page.map(({ updatedAt: _updatedAt, rank: _rank, ...contact }) => contact),
    total: filtered.length,
    offset: query.offset,
    nextOffset: shown < filtered.length ? shown : null,
    facets: facetsOf(searched),
    linkedinImport: input.linkedinImport ?? { state: 'unknown', importedAt: null, importedCount: null },
  };
}
