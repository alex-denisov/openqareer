import { randomBytes } from 'node:crypto';
import type { BrowserContext, CDPSession, Cookie, Page } from 'playwright';
import {
  acquireProfileLock,
  ensureLinkedinProfileDirectory,
  releaseProfileLock,
  touchProfileLock,
} from './linkedinProfileDirectory';
import {
  detectRemoteLoginState,
  REMOTE_LOGIN_KEYS,
  stripUrlQuery,
  type RemoteLoginInput,
  type RemoteLoginState,
} from './linkedinRemoteLoginState';

const LOGIN_URL = 'https://www.linkedin.com/login';
const IDLE_CLOSE_MS = 10 * 60_000;
const SIGNED_IN_CLOSE_MS = 5_000;
const CLOSED_RECORD_TTL_MS = 5 * 60_000;
const RATE_WINDOW_MS = 1_000;
const FRAME_LIMIT = 5;
const INPUT_LIMIT = 20;
const MAX_TEXT_LENGTH = 256;
const VIEWPORT = { width: 1440, height: 900 } as const;

export type RemoteLoginErrorCode =
  | 'remote_login_not_found'
  | 'remote_login_already_active'
  | 'linkedin_profile_busy'
  | 'remote_login_rate_limited'
  | 'remote_login_closed'
  | 'remote_login_key_not_allowed'
  | 'remote_login_text_invalid'
  | 'remote_login_unavailable';

export class RemoteLoginError extends Error {
  constructor(readonly code: RemoteLoginErrorCode) {
    super(code);
    this.name = 'RemoteLoginError';
  }
}

export type RemoteLoginCloseReason = 'closed_by_admin' | 'idle' | 'persist_failed' | 'shutdown';

export interface RemoteLoginFrame {
  readonly state: RemoteLoginState;
  readonly url: string;
  readonly imageBase64: string | null;
  readonly width: number;
  readonly height: number;
  readonly capturedAt: string | null;
  readonly reason: RemoteLoginCloseReason | null;
}

export interface RemoteLoginLog {
  warn(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
}

export interface RemoteLoginActor {
  readonly actorUserId: string;
  readonly actorUsername: string;
}

export interface RemoteLoginDependencies {
  readonly profileDirectoryFor: (accountId: string) => string;
  readonly launchContext: (profileDirectory: string, timezone: string) => Promise<BrowserContext>;
  /** Вызывается с cookie профиля, когда страница дошла до /feed. Cookie в журнал не пишутся. */
  readonly onSignedIn: (
    accountId: string,
    cookies: readonly Cookie[],
    actor: RemoteLoginActor,
  ) => Promise<void>;
  readonly log?: RemoteLoginLog;
}

interface RemoteLoginSession {
  readonly loginId: string;
  readonly accountId: string;
  readonly actor: RemoteLoginActor;
  readonly profileDirectory: string;
  readonly context: BrowserContext;
  readonly page: Page;
  state: RemoteLoginState;
  url: string;
  image: string | null;
  capturedAt: string | null;
  reason: RemoteLoginCloseReason | null;
  closed: boolean;
  closedAt: number;
  idleTimer?: NodeJS.Timeout;
  finishTimer?: NodeJS.Timeout;
  frameHits: number[];
  inputHits: number[];
}

/** Вход в LinkedIn в браузере сервера (B373): кадры наружу, ввод внутрь, профиль остаётся на сервере. */
export class LinkedinRemoteLoginService {
  private readonly sessions = new Map<string, RemoteLoginSession>();

  constructor(private readonly deps: RemoteLoginDependencies) {}

  async start(
    accountId: string,
    timezone: string,
    actor: RemoteLoginActor,
  ): Promise<{ loginId: string }> {
    this.dropExpiredRecords();
    if (this.activeFor(accountId)) throw new RemoteLoginError('remote_login_already_active');
    const profileDirectory = this.deps.profileDirectoryFor(accountId);
    ensureLinkedinProfileDirectory(profileDirectory);
    if (!acquireProfileLock(profileDirectory, 'login')) {
      throw new RemoteLoginError('linkedin_profile_busy');
    }
    try {
      const session = await this.open(accountId, actor, profileDirectory, timezone);
      this.sessions.set(session.loginId, session);
      this.armIdleTimer(session);
      this.deps.log?.info({ accountId }, 'linkedin-remote-login-started');
      return { loginId: session.loginId };
    } catch {
      releaseProfileLock(profileDirectory, 'login');
      throw new RemoteLoginError('remote_login_unavailable');
    }
  }

  frame(accountId: string, loginId: string): RemoteLoginFrame {
    const session = this.require(accountId, loginId);
    this.hit(session.frameHits, FRAME_LIMIT);
    return {
      state: session.closed && session.state !== 'signed_in' ? 'closed' : session.state,
      url: session.url,
      imageBase64: session.image,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      capturedAt: session.capturedAt,
      reason: session.reason,
    };
  }

  async input(accountId: string, loginId: string, input: RemoteLoginInput): Promise<void> {
    const session = this.require(accountId, loginId);
    if (session.closed) throw new RemoteLoginError('remote_login_closed');
    this.hit(session.inputHits, INPUT_LIMIT);
    if (input.type === 'key' && !REMOTE_LOGIN_KEYS.includes(input.key)) {
      throw new RemoteLoginError('remote_login_key_not_allowed');
    }
    if (input.type === 'text' && (input.text.length === 0 || input.text.length > MAX_TEXT_LENGTH)) {
      throw new RemoteLoginError('remote_login_text_invalid');
    }
    this.armIdleTimer(session);
    touchProfileLock(session.profileDirectory, 'login');
    await this.dispatch(session.page, input);
  }

  async close(accountId: string, loginId: string): Promise<void> {
    const session = this.require(accountId, loginId);
    await this.finish(session, 'closed_by_admin');
  }

  /** Остановка процесса: браузеры входа не переживают сервер. */
  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((session) => this.finish(session, 'shutdown')),
    );
  }

  private async dispatch(page: Page, input: RemoteLoginInput): Promise<void> {
    if (input.type === 'click') {
      await page.mouse.click(input.x, input.y);
    } else if (input.type === 'text') {
      await page.keyboard.type(input.text, { delay: 35 });
    } else {
      await page.keyboard.press(input.key);
    }
  }

  private async open(
    accountId: string,
    actor: RemoteLoginActor,
    profileDirectory: string,
    timezone: string,
  ): Promise<RemoteLoginSession> {
    const context = await this.deps.launchContext(profileDirectory, timezone);
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const session: RemoteLoginSession = {
        loginId: randomBytes(24).toString('base64url'),
        accountId,
        actor,
        profileDirectory,
        context,
        page,
        state: 'login',
        url: '',
        image: null,
        capturedAt: null,
        reason: null,
        closed: false,
        closedAt: 0,
        frameHits: [],
        inputHits: [],
      };
      await this.startScreencast(session, await context.newCDPSession(page));
      page.on('framenavigated', () => this.onNavigated(session));
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
      this.onNavigated(session);
      return session;
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  private async startScreencast(session: RemoteLoginSession, cdp: CDPSession): Promise<void> {
    cdp.on('Page.screencastFrame', (frame) => {
      session.image = frame.data;
      session.capturedAt = new Date().toISOString();
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 1280,
      everyNthFrame: 1,
    });
  }

  private onNavigated(session: RemoteLoginSession): void {
    if (session.closed) return;
    const rawUrl = session.page.url();
    session.url = stripUrlQuery(rawUrl);
    const previous = session.state === 'closed' ? 'login' : session.state;
    session.state = detectRemoteLoginState(rawUrl, previous);
    if (session.state === 'signed_in' && !session.finishTimer) {
      session.finishTimer = setTimeout(() => void this.completeSignIn(session), SIGNED_IN_CLOSE_MS);
    }
  }

  private async completeSignIn(session: RemoteLoginSession): Promise<void> {
    if (session.closed) return;
    try {
      const cookies = await session.context.cookies();
      await this.deps.onSignedIn(session.accountId, cookies, session.actor);
      this.deps.log?.info({ accountId: session.accountId }, 'linkedin-remote-login-signed-in');
      await this.finish(session, null);
    } catch (error) {
      this.deps.log?.warn(
        { accountId: session.accountId, reason: error instanceof Error ? error.name : 'unknown' },
        'linkedin-remote-login-persist-failed',
      );
      session.state = 'closed';
      await this.finish(session, 'persist_failed');
    }
  }

  private async finish(
    session: RemoteLoginSession,
    reason: RemoteLoginCloseReason | null,
  ): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    session.closedAt = Date.now();
    session.reason = reason;
    if (reason && session.state !== 'signed_in') session.state = 'closed';
    clearTimeout(session.idleTimer);
    clearTimeout(session.finishTimer);
    await session.context.close().catch(() => undefined);
    releaseProfileLock(session.profileDirectory, 'login');
  }

  private armIdleTimer(session: RemoteLoginSession): void {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => void this.finish(session, 'idle'), IDLE_CLOSE_MS);
  }

  private hit(hits: number[], limit: number): void {
    const now = Date.now();
    while (hits.length > 0 && now - (hits[0] ?? now) >= RATE_WINDOW_MS) hits.shift();
    if (hits.length >= limit) throw new RemoteLoginError('remote_login_rate_limited');
    hits.push(now);
  }

  private require(accountId: string, loginId: string): RemoteLoginSession {
    const session = this.sessions.get(loginId);
    if (!session || session.accountId !== accountId) throw new RemoteLoginError('remote_login_not_found');
    return session;
  }

  private activeFor(accountId: string): RemoteLoginSession | undefined {
    return [...this.sessions.values()].find(
      (session) => session.accountId === accountId && !session.closed,
    );
  }

  private dropExpiredRecords(): void {
    const now = Date.now();
    for (const [loginId, session] of this.sessions) {
      if (session.closed && now - session.closedAt > CLOSED_RECORD_TTL_MS) this.sessions.delete(loginId);
    }
  }
}
