import type { DetailReadThrottle } from './linkedinSessionPoll';
import {
  LINKEDIN_CONNECTIONS_URL,
  errorCode,
  importLinkedInConnectionsFromSession,
  type LinkedInConnectionsImportOutcome,
} from './linkedinConnectionsImport';
import {
  closeConnectorSession,
  isConnectorSessionOpen,
  logConnectorDiagnostic,
  openConnectorSession,
  readSessionPage,
  saveLinkedInCaptureDump,
} from './connectorSession';
import { importLinkedInConnectionContacts } from '../outreach/connectionContactsApi';
import { endLinkedInProtectedRoute, startLinkedInProtectedRoute } from './linkedinProtectedRoute';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';

const CONTACTS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const CONTACTS_REFRESH_STORAGE_KEY = 'openqareer.linkedin.lastContactsRefreshAt.v1';

export interface LinkedInContactsRefreshDependencies {
  readonly isDesktop: boolean;
  readonly linkedinConnected: boolean;
  readonly throttle?: DetailReadThrottle;
  /** True while the candidate has the LinkedIn window open for their own use. */
  readonly isSessionOpen?: () => Promise<boolean>;
  /** Raises the same protected route the connect dialog uses (B167). */
  readonly prepareRoute: () => Promise<{ readonly release: () => Promise<void> }>;
  /** Opens the signed-in session window where the candidate does not see it. */
  readonly openOutOfSight: () => Promise<boolean>;
  readonly importContacts: () => Promise<LinkedInConnectionsImportOutcome>;
  readonly close: () => Promise<unknown>;
  /** One line per run in the local diagnostics log; codes only, never page text. */
  readonly log: (event: string, detail?: string) => void;
}

export type LinkedInContactsRefreshOutcome =
  | LinkedInConnectionsImportOutcome
  | {
      readonly status: 'skipped';
      readonly reason: 'not_eligible' | 'window_unavailable' | 'route_unavailable' | 'read_failed';
      readonly detail?: string;
    };

const FAILURE_RETRY_MS = 60 * 60 * 1_000;

/**
 * Reads only the candidate's contacts when LinkedIn is already connected
 * (B448, owner 23.10): no profile import, no new UI. A completed read spends
 * the 24 h gate; a failed one is retried after an hour. It never throws,
 * always closes what it opened and leaves one diagnostics line per run.
 */
export async function refreshLinkedInContacts(
  dependencies: LinkedInContactsRefreshDependencies,
): Promise<LinkedInContactsRefreshOutcome> {
  if (!dependencies.isDesktop || !dependencies.linkedinConnected) {
    return { status: 'skipped', reason: 'not_eligible' };
  }
  const throttle = dependencies.throttle ?? storageThrottle;
  const last = throttle.lastReadAt();
  if (last !== undefined && Date.now() - last < CONTACTS_REFRESH_INTERVAL_MS) {
    return { status: 'skipped', reason: 'recently_read' };
  }
  const outcome = await runRefresh(dependencies);
  const completed = outcome.status === 'uploading' || outcome.reason === 'no_contacts';
  const now = Date.now();
  throttle.markRead(completed ? now : now - CONTACTS_REFRESH_INTERVAL_MS + FAILURE_RETRY_MS);
  dependencies.log(
    outcome.status === 'uploading' ? 'uploading' : outcome.reason,
    outcome.status === 'uploading' ? String(outcome.count) : outcome.detail,
  );
  return outcome;
}

async function runRefresh(
  dependencies: LinkedInContactsRefreshDependencies,
): Promise<LinkedInContactsRefreshOutcome> {
  if (await dependencies.isSessionOpen?.().catch(() => true)) {
    return { status: 'skipped', reason: 'window_unavailable', detail: 'in_use' };
  }
  let route: { readonly release: () => Promise<void> };
  try {
    route = await dependencies.prepareRoute();
  } catch (error) {
    return { status: 'skipped', reason: 'route_unavailable', detail: errorCode(error) };
  }
  try {
    const opened = await dependencies.openOutOfSight().catch(() => false);
    if (!opened) return { status: 'skipped', reason: 'window_unavailable', detail: 'open_failed' };
    try {
      return await dependencies.importContacts();
    } catch (error) {
      return { status: 'skipped', reason: 'read_failed', detail: errorCode(error) };
    } finally {
      await dependencies.close().catch(() => undefined);
    }
  } finally {
    await route.release().catch(() => undefined);
  }
}

const storageThrottle: DetailReadThrottle = {
  lastReadAt: () => {
    try {
      const raw = globalThis.localStorage?.getItem(CONTACTS_REFRESH_STORAGE_KEY);
      const at = raw ? Number(raw) : Number.NaN;
      return Number.isFinite(at) ? at : undefined;
    } catch {
      return undefined;
    }
  },
  markRead: (at) => {
    try {
      globalThis.localStorage?.setItem(CONTACTS_REFRESH_STORAGE_KEY, String(at));
    } catch {
      // Storage may be unavailable; the Rust-side read admission still applies.
    }
  },
};

const DIAGNOSTIC_SCOPE = 'linkedin-contacts';
const EARLY_SKIPS: ReadonlySet<string> = new Set(['not_eligible', 'recently_read']);
const OUT_OF_SIGHT_GAP_PX = 4_000;
const OUT_OF_SIGHT_WIDTH_PX = 1156;
const OUT_OF_SIGHT_HEIGHT_PX = 900;
// The 24 h refresh gate already spaces this read; the 12 h gate inside the
// import is for the import flow and must not double-skip it.
const alwaysDue: DetailReadThrottle = { lastReadAt: () => undefined, markRead: () => undefined };
let inFlight: Promise<LinkedInContactsRefreshOutcome> | undefined;

/**
 * Runs the contacts-only refresh against the desktop shell. The session window
 * is a child of the main window placed past its right edge, so the main
 * window clips it: a hidden WKWebView stops running the read script (B157).
 */
export function startLinkedInContactsRefresh(
  linkedinConnected: boolean,
): Promise<LinkedInContactsRefreshOutcome> {
  if (inFlight) return inFlight;
  const log = (event: string, detail?: string) =>
    logConnectorDiagnostic(DIAGNOSTIC_SCOPE, event, detail);
  inFlight = refreshLinkedInContacts({
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
    openOutOfSight: async () =>
      (
        await openConnectorSession('linkedin', LINKEDIN_CONNECTIONS_URL, {
          x: window.innerWidth + OUT_OF_SIGHT_GAP_PX,
          y: 0,
          width: OUT_OF_SIGHT_WIDTH_PX,
          height: OUT_OF_SIGHT_HEIGHT_PX,
        })
      ).opened,
    importContacts: () =>
      importLinkedInConnectionsFromSession({
        readSessionPage: (url) => readSessionPage('linkedin', url),
        upload: importLinkedInConnectionContacts,
        saveCaptureDump: () => saveLinkedInCaptureDump('connections'),
        throttle: alwaysDue,
      }),
    close: () => closeConnectorSession('linkedin'),
  })
    .then((outcome) => {
      // Runs that stop before the window are logged here, so a trigger that
      // fired and did nothing still leaves a line.
      if (outcome.status === 'skipped' && EARLY_SKIPS.has(outcome.reason)) log(outcome.reason);
      return outcome;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}
