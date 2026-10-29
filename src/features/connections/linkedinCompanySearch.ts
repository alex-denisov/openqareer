import type { DetailReadThrottle } from './linkedinSessionPoll';
import type { SessionPageResult } from './connectorSession';
import {
  closeConnectorSession,
  isConnectorSessionOpen,
  logConnectorDiagnostic,
  openConnectorSession,
  readSessionPage,
} from './connectorSession';
import { errorCode } from './linkedinConnectionsImport';
import {
  extractLinkedInPeopleSearch,
  linkedinPeopleSearchUrl,
  type LinkedInSearchPerson,
} from './linkedinPeopleSearchExtract';
import {
  loadLinkedInCompanySearchPlan,
  reportLinkedInCompanySearch,
  type LinkedInCompanySearchTarget,
} from '../outreach/connectionContactsApi';
import { endLinkedInProtectedRoute, startLinkedInProtectedRoute } from './linkedinProtectedRoute';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';

/**
 * B561: the current company of the candidate's contacts, read from LinkedIn's
 * people search limited to the 1st circle, one company at a time. The server
 * plans the companies (wanted, then vacancy companies, each once per 14 days);
 * the desktop paces the pages on its own search budget. Like the contacts
 * refresh it runs out of sight, never throws and closes what it opened.
 */
export interface LinkedInCompanySearchDependencies {
  readonly isDesktop: boolean;
  readonly linkedinConnected: boolean;
  readonly throttle?: DetailReadThrottle;
  readonly isSessionOpen: () => Promise<boolean>;
  readonly prepareRoute: () => Promise<{ readonly release: () => Promise<void> }>;
  readonly openOutOfSight: (firstUrl: string) => Promise<boolean>;
  readonly close: () => Promise<unknown>;
  readonly log: (event: string, detail?: string) => void;
  readonly loadPlan: () => Promise<readonly LinkedInCompanySearchTarget[]>;
  readonly readSessionPage: (url: string) => Promise<SessionPageResult>;
  readonly report: (
    companyName: string,
    people: readonly LinkedInSearchPerson[],
  ) => Promise<unknown>;
}

export type LinkedInCompanySearchOutcome =
  | {
      readonly status: 'searched' | 'stopped';
      readonly reason?: string;
      readonly companies: number;
      readonly pages: number;
      readonly found: number;
    }
  | {
      readonly status: 'skipped';
      readonly reason:
        | 'not_eligible'
        | 'recently_read'
        | 'nothing_planned'
        | 'plan_failed'
        | 'window_unavailable'
        | 'route_unavailable';
      readonly detail?: string;
    };

const SEARCH_RUN_INTERVAL_MS = 12 * 60 * 60 * 1_000;
const SEARCH_RUN_STORAGE_KEY = 'openqareer.linkedin.lastCompanySearchAt.v1';
/** Within the desktop's 20 searches a day: two runs of up to 8 companies. */
const MAX_COMPANIES_PER_RUN = 8;
const MAX_PAGES_PER_COMPANY = 2;
/** LinkedIn shows ten people a page; a shorter page is the last one. */
const FULL_PAGE_CARDS = 10;
const SEARCH_PATH = '/search/results/people';

interface RunTotals {
  readonly companies: number;
  readonly pages: number;
  readonly found: number;
}

export async function searchLinkedInCompanies(
  dependencies: LinkedInCompanySearchDependencies,
): Promise<LinkedInCompanySearchOutcome> {
  if (!dependencies.isDesktop || !dependencies.linkedinConnected) {
    return { status: 'skipped', reason: 'not_eligible' };
  }
  const throttle = dependencies.throttle ?? storageThrottle;
  const last = throttle.lastReadAt();
  if (last !== undefined && Date.now() - last < SEARCH_RUN_INTERVAL_MS) {
    return { status: 'skipped', reason: 'recently_read' };
  }
  let plan: readonly LinkedInCompanySearchTarget[];
  try {
    plan = (await dependencies.loadPlan()).slice(0, MAX_COMPANIES_PER_RUN);
  } catch (error) {
    return { status: 'skipped', reason: 'plan_failed', detail: errorCode(error) };
  }
  if (plan.length === 0) return { status: 'skipped', reason: 'nothing_planned' };
  if (await dependencies.isSessionOpen().catch(() => true)) {
    return { status: 'skipped', reason: 'window_unavailable', detail: 'in_use' };
  }
  let route: { readonly release: () => Promise<void> };
  try {
    route = await dependencies.prepareRoute();
  } catch (error) {
    return { status: 'skipped', reason: 'route_unavailable', detail: errorCode(error) };
  }
  try {
    const firstUrl = linkedinPeopleSearchUrl(plan[0]!.companyName, 1);
    const opened = await dependencies.openOutOfSight(firstUrl).catch(() => false);
    if (!opened) return { status: 'skipped', reason: 'window_unavailable', detail: 'open_failed' };
    throttle.markRead(Date.now());
    try {
      return await searchPlannedCompanies(dependencies, plan);
    } finally {
      await dependencies.close().catch(() => undefined);
    }
  } finally {
    await route.release().catch(() => undefined);
  }
}

async function searchPlannedCompanies(
  dependencies: LinkedInCompanySearchDependencies,
  plan: readonly LinkedInCompanySearchTarget[],
): Promise<LinkedInCompanySearchOutcome> {
  let totals: RunTotals = { companies: 0, pages: 0, found: 0 };
  for (const company of plan) {
    const result = await searchCompany(dependencies, company.companyName);
    totals = { ...totals, pages: totals.pages + result.pages };
    if (result.stop) {
      dependencies.log('stopped', result.stop);
      return { status: 'stopped', reason: result.stop, ...totals };
    }
    // The server logs its own failures; an unsent company is searched again later.
    await dependencies.report(company.companyName, result.people).catch(() => undefined);
    totals = {
      ...totals,
      companies: totals.companies + 1,
      found: totals.found + result.people.length,
    };
  }
  dependencies.log('companies', String(totals.companies));
  dependencies.log('found', String(totals.found));
  return { status: 'searched', ...totals };
}

async function searchCompany(
  dependencies: LinkedInCompanySearchDependencies,
  companyName: string,
): Promise<{ people: LinkedInSearchPerson[]; pages: number; stop?: string }> {
  const people: LinkedInSearchPerson[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_COMPANY; page += 1) {
    let result: SessionPageResult;
    try {
      result = await dependencies.readSessionPage(linkedinPeopleSearchUrl(companyName, page));
    } catch (error) {
      return { people, pages: page - 1, stop: errorCode(error) };
    }
    const landed = landedSection(result);
    if (landed !== 'search') return { people, pages: page, stop: landed };
    const read = extractLinkedInPeopleSearch(result.body ?? '');
    people.push(...read.people);
    if (read.cards < FULL_PAGE_CARDS) return { people, pages: page };
  }
  return { people, pages: MAX_PAGES_PER_COMPANY };
}

/** `search` when the read stayed on people search, else where it went, as a code. */
function landedSection(page: SessionPageResult): string {
  if (!page.ok || !page.body) return 'empty';
  try {
    const url = new URL(page.url ?? '');
    if (url.hostname.endsWith('linkedin.com') && url.pathname.startsWith(SEARCH_PATH)) {
      return 'search';
    }
    const segment = url.pathname.split('/').find(Boolean) ?? 'root';
    return /^[a-z0-9-]{1,40}$/u.test(segment) ? segment : 'other';
  } catch {
    return 'no_url';
  }
}

const storageThrottle: DetailReadThrottle = {
  lastReadAt: () => {
    try {
      const raw = globalThis.localStorage?.getItem(SEARCH_RUN_STORAGE_KEY);
      const at = raw ? Number(raw) : Number.NaN;
      return Number.isFinite(at) ? at : undefined;
    } catch {
      return undefined;
    }
  },
  markRead: (at) => {
    try {
      globalThis.localStorage?.setItem(SEARCH_RUN_STORAGE_KEY, String(at));
    } catch {
      // Storage may be unavailable; the desktop's search budget still applies.
    }
  },
};

const DIAGNOSTIC_SCOPE = 'linkedin-company-search';
const OUT_OF_SIGHT_GAP_PX = 4_000;
const OUT_OF_SIGHT_WIDTH_PX = 1156;
const OUT_OF_SIGHT_HEIGHT_PX = 900;
let inFlight: Promise<LinkedInCompanySearchOutcome> | undefined;

/**
 * Runs the company search against the desktop shell, out of sight like the
 * contacts refresh (B157): a hidden WKWebView stops running page scripts.
 */
export function startLinkedInCompanySearch(
  linkedinConnected: boolean,
): Promise<LinkedInCompanySearchOutcome> {
  if (inFlight) return inFlight;
  const log = (event: string, detail?: string) =>
    logConnectorDiagnostic(DIAGNOSTIC_SCOPE, event, detail);
  inFlight = searchLinkedInCompanies({
    isDesktop: isTauriEnvironment(),
    linkedinConnected,
    log,
    isSessionOpen: () => isConnectorSessionOpen('linkedin'),
    prepareRoute: async () => {
      const route = await startLinkedInProtectedRoute();
      return {
        release: () => (route.tunnelActive ? endLinkedInProtectedRoute() : Promise.resolve()),
      };
    },
    openOutOfSight: async (firstUrl) =>
      (
        await openConnectorSession('linkedin', firstUrl, {
          x: window.innerWidth + OUT_OF_SIGHT_GAP_PX,
          y: 0,
          width: OUT_OF_SIGHT_WIDTH_PX,
          height: OUT_OF_SIGHT_HEIGHT_PX,
        })
      ).opened,
    close: () => closeConnectorSession('linkedin'),
    loadPlan: loadLinkedInCompanySearchPlan,
    readSessionPage: (url) => readSessionPage('linkedin', url),
    report: reportLinkedInCompanySearch,
  })
    .then((outcome) => {
      if (outcome.status === 'skipped') log(outcome.reason, outcome.detail);
      return outcome;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}
