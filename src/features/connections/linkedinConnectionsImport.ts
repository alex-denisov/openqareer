import type { SessionPageResult } from './connectorSession';
import type {
  LinkedInConnectionImportContact,
  LinkedInConnectionImportReceipt,
} from '../outreach/connectionContactsApi';
import type { DetailReadThrottle } from './linkedinSessionPoll';
import {
  extractLinkedInConnections,
  toConnectionImportContacts,
} from './linkedinConnectionsExtract';

export const LINKEDIN_CONNECTIONS_URL =
  'https://www.linkedin.com/mynetwork/invite-connect/connections/';
const CONNECTIONS_PATH = '/mynetwork/invite-connect/connections';
/** The server's import route accepts at most 400 contacts per call. */
export const MAX_IMPORTED_CONNECTIONS = 400;
const MAX_CONNECTIONS_PAGE_BYTES = 8 * 1_024 * 1_024;
const CONNECTIONS_READ_INTERVAL_MS = 12 * 60 * 60 * 1_000;
const CONNECTIONS_READ_STORAGE_KEY = 'openqareer.linkedin.lastConnectionsReadAt.v1';

export interface LinkedInConnectionsImportDependencies {
  readonly readSessionPage: (url: string) => Promise<SessionPageResult>;
  readonly upload: (
    contacts: readonly LinkedInConnectionImportContact[],
  ) => Promise<LinkedInConnectionImportReceipt | unknown>;
  readonly throttle?: DetailReadThrottle;
  /**
   * Keeps the already-sanitized page on this machine when it yields no
   * contacts, so the parser can be tuned to LinkedIn's real markup. Local
   * only: nothing here goes to the server.
   */
  readonly saveCaptureDump?: (body: string) => Promise<unknown>;
}

export type LinkedInConnectionsImportOutcome =
  | { readonly status: 'uploading'; readonly count: number }
  | {
      readonly status: 'skipped';
      readonly reason: 'recently_read' | 'read_failed' | 'not_connections_page' | 'no_contacts';
    };

/**
 * Reads the candidate's own connections in the open session window and hands
 * them to the server in the background (B448). It never throws: contacts are
 * a bonus to the connection, so nothing here may fail the profile import.
 */
export async function importLinkedInConnectionsFromSession(
  dependencies: LinkedInConnectionsImportDependencies,
): Promise<LinkedInConnectionsImportOutcome> {
  const throttle = dependencies.throttle ?? storageThrottle;
  const last = throttle.lastReadAt();
  const now = Date.now();
  if (last !== undefined && now - last < CONNECTIONS_READ_INTERVAL_MS) {
    return { status: 'skipped', reason: 'recently_read' };
  }
  throttle.markRead(now);
  const page = await dependencies.readSessionPage(LINKEDIN_CONNECTIONS_URL).catch(() => undefined);
  if (!page) return { status: 'skipped', reason: 'read_failed' };
  if (
    !page.ok ||
    !page.body ||
    page.body.length > MAX_CONNECTIONS_PAGE_BYTES ||
    !landedOnConnections(page.url)
  ) {
    return { status: 'skipped', reason: 'not_connections_page' };
  }
  const contacts = toConnectionImportContacts(
    extractLinkedInConnections(page.body),
    MAX_IMPORTED_CONNECTIONS,
  );
  if (contacts.length === 0) {
    await dependencies.saveCaptureDump?.(page.body).catch(() => undefined);
    return { status: 'skipped', reason: 'no_contacts' };
  }
  // The server logs its own failures; a lost upload is retried on the next read.
  void dependencies.upload(contacts).catch(() => undefined);
  return { status: 'uploading', count: contacts.length };
}

// A redirect to /checkpoint/ or /authwall still answers ok=true (B266).
function landedOnConnections(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.hostname.endsWith('linkedin.com') && url.pathname.startsWith(CONNECTIONS_PATH);
  } catch {
    return false;
  }
}

const storageThrottle: DetailReadThrottle = {
  lastReadAt: () => {
    try {
      const raw = globalThis.localStorage?.getItem(CONNECTIONS_READ_STORAGE_KEY);
      const at = raw ? Number(raw) : Number.NaN;
      return Number.isFinite(at) ? at : undefined;
    } catch {
      return undefined;
    }
  },
  markRead: (at) => {
    try {
      globalThis.localStorage?.setItem(CONNECTIONS_READ_STORAGE_KEY, String(at));
    } catch {
      // Storage may be unavailable; the Rust-side read admission still applies.
    }
  },
};
