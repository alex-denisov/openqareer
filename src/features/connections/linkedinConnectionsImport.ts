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
/** The server's import route accepts at most 2 000 contacts per call. */
export const MAX_IMPORTED_CONNECTIONS = 2_000;
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
  | {
      readonly status: 'uploading';
      /** Contacts with a company, sent to the server. */
      readonly count: number;
      /** People read from the page. */
      readonly parsed: number;
      /** People with a company, before the per-import cap. */
      readonly withCompany: number;
    }
  | {
      readonly status: 'skipped';
      readonly reason: 'recently_read' | 'read_failed' | 'not_connections_page' | 'no_contacts';
      /** A short code for the local diagnostics log; never page text. */
      readonly detail?: string;
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
  let page: SessionPageResult;
  try {
    page = await dependencies.readSessionPage(LINKEDIN_CONNECTIONS_URL);
  } catch (error) {
    return { status: 'skipped', reason: 'read_failed', detail: errorCode(error) };
  }
  if (
    !page.ok ||
    !page.body ||
    page.body.length > MAX_CONNECTIONS_PAGE_BYTES ||
    !landedOnConnections(page.url)
  ) {
    return { status: 'skipped', reason: 'not_connections_page', detail: landedSection(page) };
  }
  const connections = extractLinkedInConnections(page.body);
  const placed = toConnectionImportContacts(connections, Number.POSITIVE_INFINITY);
  const contacts = placed.slice(0, MAX_IMPORTED_CONNECTIONS);
  if (contacts.length === 0) {
    await dependencies.saveCaptureDump?.(page.body).catch(() => undefined);
    return { status: 'skipped', reason: 'no_contacts', detail: String(connections.length) };
  }
  // The server logs its own failures; a lost upload is retried on the next read.
  void dependencies.upload(contacts).catch(() => undefined);
  return {
    status: 'uploading',
    count: contacts.length,
    parsed: connections.length,
    withCompany: placed.length,
  };
}

/** The leading `snake_case` code of a shell error, e.g. `page_load_timeout`. */
export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^[a-z][a-z0-9_]{0,59}/u.exec(message)?.[0] ?? 'unknown';
}

/** Where the read ended up, as a code only: `checkpoint`, `authwall`, `empty`. */
function landedSection(page: SessionPageResult): string {
  if (!page.ok || !page.body) return 'empty';
  if (page.body.length > MAX_CONNECTIONS_PAGE_BYTES) return 'too_large';
  try {
    const segment = new URL(page.url ?? '').pathname.split('/').find(Boolean) ?? 'root';
    return /^[a-z0-9-]{1,40}$/u.test(segment) ? segment : 'other';
  } catch {
    return 'no_url';
  }
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
