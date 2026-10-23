import type { DetailReadThrottle } from './linkedinSessionPoll';
import {
  LINKEDIN_CONNECTIONS_URL,
  importLinkedInConnectionsFromSession,
  type LinkedInConnectionsImportOutcome,
} from './linkedinConnectionsImport';
import {
  closeConnectorSession,
  isConnectorSessionOpen,
  openConnectorSession,
  readSessionPage,
  saveLinkedInCaptureDump,
} from './connectorSession';
import { importLinkedInConnectionContacts } from '../outreach/connectionContactsApi';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';

const CONTACTS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const CONTACTS_REFRESH_STORAGE_KEY = 'openqareer.linkedin.lastContactsRefreshAt.v1';

export interface LinkedInContactsRefreshDependencies {
  readonly isDesktop: boolean;
  readonly linkedinConnected: boolean;
  readonly throttle?: DetailReadThrottle;
  /** True while the candidate has the LinkedIn window open for their own use. */
  readonly isSessionOpen?: () => Promise<boolean>;
  /** Opens the signed-in session window where the candidate does not see it. */
  readonly openOutOfSight: () => Promise<boolean>;
  readonly importContacts: () => Promise<LinkedInConnectionsImportOutcome>;
  readonly close: () => Promise<unknown>;
}

export type LinkedInContactsRefreshOutcome =
  | LinkedInConnectionsImportOutcome
  | {
      readonly status: 'skipped';
      readonly reason: 'not_eligible' | 'window_unavailable' | 'read_failed';
    };

/**
 * Reads only the candidate's contacts when LinkedIn is already connected
 * (B448, owner 23.10): no profile import, no new UI, at most once per 24 h.
 * It never throws and always closes the window it opened.
 */
export async function refreshLinkedInContacts(
  dependencies: LinkedInContactsRefreshDependencies,
): Promise<LinkedInContactsRefreshOutcome> {
  if (!dependencies.isDesktop || !dependencies.linkedinConnected) {
    return { status: 'skipped', reason: 'not_eligible' };
  }
  const throttle = dependencies.throttle ?? storageThrottle;
  const last = throttle.lastReadAt();
  const now = Date.now();
  if (last !== undefined && now - last < CONTACTS_REFRESH_INTERVAL_MS) {
    return { status: 'skipped', reason: 'recently_read' };
  }
  if (await dependencies.isSessionOpen?.().catch(() => true)) {
    return { status: 'skipped', reason: 'window_unavailable' };
  }
  throttle.markRead(now);
  const opened = await dependencies.openOutOfSight().catch(() => false);
  if (!opened) return { status: 'skipped', reason: 'window_unavailable' };
  try {
    return await dependencies.importContacts();
  } catch {
    return { status: 'skipped', reason: 'read_failed' };
  } finally {
    await dependencies.close().catch(() => undefined);
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

const OUT_OF_SIGHT_GAP_PX = 40;
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
  inFlight = refreshLinkedInContacts({
    isDesktop: isTauriEnvironment(),
    linkedinConnected,
    isSessionOpen: () => isConnectorSessionOpen('linkedin'),
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
  }).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
