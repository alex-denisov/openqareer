/**
 * B643-8: company of an aggregator, hh or LinkedIn search row by exact name. Employer boards are
 * tied through `company_placement`; here only rows of aggregators. CPO 11.11:
 * hh individuals and generic names are never linked; a name several
 * directory companies share stays without a link.
 */
import { PRIVATE_EMPLOYER, publicEmployerName } from '../../../shared/privateEmployer';
import { nameKey } from '../freehire/freehireImport';
import { sourceKind } from '../../vacancies/poolLiveness';
import { linkByEmployerName, type LinkageIndex } from './placementLinkage';

/** nameKey forms of placeholders that name no employer. */
const GENERIC_NAMES: ReadonlySet<string> = new Set([
  'confidential', 'confidential-company', 'anonymous', 'anonymous-employer', 'private', 'private-company',
  'undisclosed', 'stealth', 'stealth-startup', 'stealth-mode', 'company', 'employer', 'our-client', 'client',
  'unknown', 'n-a', 'na', 'none', 'various', 'multiple', 'remote', 'jobs', 'careers', 'hiring', 'recruiter',
  'recruitment', 'staffing', 'talent', 'hr', 'startup', 'agency', 'freelance', 'self-employed',
  'компания', 'работодатель', 'не-указано', 'конфиденциально', 'кадровое-агентство', 'частный-работодатель',
  'частное-лицо', 'анонимный-работодатель',
]);
const MIN_KEY = 2;

export interface AggregatorRow {
  readonly sourceId: string;
  readonly company: string | null | undefined;
  readonly employerIsPerson?: boolean;
}

export type AggregatorLink =
  | { readonly status: 'linked'; readonly companyKey: string; readonly how: LinkHow }
  | { readonly status: 'skipped'; readonly reason: 'employer_board' | 'person' | 'generic' | 'ambiguous' | 'unlinked' | 'loose_name' };

/** `exact_name_single_word`: one dictionary-like word («Porter», «Атлант») — B643-12 must not merge on it alone. */
export type LinkHow = 'exact_name' | 'exact_name_single_word';

const LEGAL_FORM = /\b(inc|llc|ltd|limited|gmbh|ag|sa|sas|bv|corp|corporation|co|plc|oy|ab|as|srl|spa|pty|ооо|оао|зао|пао|ао)\b\.?/g;

/**
 * Stricter than `nameKey`: keeps «group», «holding», «+» and «&», so «Леон +»
 * does not meet «Леон» and «Alchemy Group» does not meet «Alchemy».
 */
export function strictNameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9а-яё]+/g, ' ')
    .replace(LEGAL_FORM, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function isGenericEmployerName(name: string): boolean {
  const key = nameKey(name);
  return key.length < MIN_KEY || GENERIC_NAMES.has(key);
}

export function linkAggregatorRow(
  row: AggregatorRow,
  index: LinkageIndex,
  directoryName: (companyKey: string) => string | undefined,
): AggregatorLink {
  const { kind } = sourceKind(row.sourceId);
  // Company LinkedIn pages are placements; LinkedIn job search is an aggregator here.
  const employerBoard = kind === 'ats' || kind === 'employer_site' || row.sourceId.startsWith('src-company-li-');
  if (employerBoard) return { status: 'skipped', reason: 'employer_board' };
  const name = row.company?.trim() ?? '';
  if (publicEmployerName(name, row.employerIsPerson) === PRIVATE_EMPLOYER) return { status: 'skipped', reason: 'person' };
  if (isGenericEmployerName(name)) return { status: 'skipped', reason: 'generic' };
  const link = linkByEmployerName(name, index);
  if (link.status !== 'linked') return { status: 'skipped', reason: link.status };
  const strict = strictNameKey(name);
  if (strict !== strictNameKey(directoryName(link.companyKey) ?? '')) return { status: 'skipped', reason: 'loose_name' };
  const how: LinkHow = strict.includes(' ') ? 'exact_name' : 'exact_name_single_word';
  return { status: 'linked', companyKey: link.companyKey, how };
}
