import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinRemoteLoginService, RemoteLoginError } from './linkedinRemoteLogin';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ACTOR = { actorUserId: 'admin-1', actorUsername: 'admin.test' };
const OTHER = '22222222-2222-4222-8222-222222222222';
const directories: string[] = [];

function fakeBrowser() {
  let currentUrl = 'about:blank';
  const pageListeners: Array<() => void> = [];
  const cdpListeners = new Map<string, (payload: unknown) => void>();
  const page = {
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    url: () => currentUrl,
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'framenavigated') pageListeners.push(listener);
    }),
    mouse: { click: vi.fn(async () => undefined) },
    keyboard: { type: vi.fn(async () => undefined), press: vi.fn(async () => undefined) },
  };
  const cdp = {
    send: vi.fn(async () => undefined),
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      cdpListeners.set(event, listener);
    }),
  };
  const context = {
    pages: () => [page],
    newPage: async () => page,
    newCDPSession: async () => cdp,
    cookies: vi.fn(async () => [{ name: 'li_at', value: 'secret-cookie-value' }]),
    close: vi.fn(async () => undefined),
  };
  return {
    page,
    cdp,
    context,
    navigate(url: string) {
      currentUrl = url;
      pageListeners.forEach((listener) => listener());
    },
    frame(data: string) {
      cdpListeners.get('Page.screencastFrame')?.({ data, sessionId: 7 });
    },
  };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'openqareer-remote-login-'));
  directories.push(root);
  const profile = join(root, 'profiles', ACCOUNT);
  const fake = fakeBrowser();
  const launchContext = vi.fn(async () => fake.context as never);
  const onSignedIn = vi.fn(async () => undefined);
  const log = { warn: vi.fn(), info: vi.fn() };
  const service = new LinkedinRemoteLoginService({
    profileDirectoryFor: (accountId) => join(root, 'profiles', accountId),
    launchContext,
    onSignedIn,
    log,
  });
  return { service, fake, launchContext, onSignedIn, log, profile };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('LinkedinRemoteLoginService', () => {
  it('opens the login page in the account profile under the profile lock', async () => {
    const { service, fake, launchContext, profile } = setup();
    const { loginId } = await service.start(ACCOUNT, 'Europe/Berlin', ACTOR);
    expect(loginId).toMatch(/^[A-Za-z0-9_-]{20,}$/u);
    expect(launchContext).toHaveBeenCalledWith(profile, 'Europe/Berlin');
    expect(fake.page.goto).toHaveBeenCalledWith(
      'https://www.linkedin.com/login',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
    expect(fake.cdp.send).toHaveBeenCalledWith(
      'Page.startScreencast',
      expect.objectContaining({ format: 'jpeg', quality: 60, maxWidth: 1280 }),
    );
    expect(existsSync(join(profile, '.lock'))).toBe(true);
  });

  it('allows one login per account and leaves a busy profile alone', async () => {
    const { service, launchContext } = setup();
    await service.start(ACCOUNT, 'UTC', ACTOR);
    await expect(service.start(ACCOUNT, 'UTC', ACTOR)).rejects.toMatchObject({
      code: 'remote_login_already_active',
    });
    expect(launchContext).toHaveBeenCalledTimes(1);
  });

  it('does not start while the executor holds the profile', async () => {
    const { service, launchContext, profile } = setup();
    mkdirSync(profile, { recursive: true });
    writeFileSync(
      join(profile, '.lock'),
      JSON.stringify({ pid: process.pid, owner: 'executor', at: Date.now() }),
    );
    await expect(service.start(ACCOUNT, 'UTC', ACTOR)).rejects.toMatchObject({
      code: 'linkedin_profile_busy',
    });
    expect(launchContext).not.toHaveBeenCalled();
  });

  it('returns the last frame with a query-free url and the detected state', async () => {
    const { service, fake } = setup();
    const { loginId } = await service.start(ACCOUNT, 'UTC', ACTOR);
    fake.navigate('https://www.linkedin.com/checkpoint/challenge/x?token=secret');
    fake.frame('QUJD');
    expect(service.frame(ACCOUNT, loginId)).toMatchObject({
      imageBase64: 'QUJD',
      url: 'https://www.linkedin.com/checkpoint/challenge/x',
      state: 'checkpoint',
      width: 1440,
      height: 900,
    });
    expect(fake.cdp.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 7 });
  });

  it('hides a login from another account and unknown ids', async () => {
    const { service } = setup();
    const { loginId } = await service.start(ACCOUNT, 'UTC', ACTOR);
    expect(() => service.frame(OTHER, loginId)).toThrowError(RemoteLoginError);
    expect(() => service.frame(ACCOUNT, 'nope')).toThrowError(
      expect.objectContaining({ code: 'remote_login_not_found' }),
    );
  });

  it('dispatches click, text and whitelisted keys and never logs typed text', async () => {
    const { service, fake, log } = setup();
    const { loginId } = await service.start(ACCOUNT, 'UTC', ACTOR);
    await service.input(ACCOUNT, loginId, { type: 'click', x: 10, y: 20 });
    await service.input(ACCOUNT, loginId, { type: 'text', text: 'hunter2-secret' });
    await service.input(ACCOUNT, loginId, { type: 'key', key: 'Enter' });
    expect(fake.page.mouse.click).toHaveBeenCalledWith(10, 20);
    expect(fake.page.keyboard.type).toHaveBeenCalledWith('hunter2-secret', expect.any(Object));
    expect(fake.page.keyboard.press).toHaveBeenCalledWith('Enter');
    await expect(
      service.input(ACCOUNT, loginId, { type: 'key', key: 'F12' as never }),
    ).rejects.toMatchObject({ code: 'remote_login_key_not_allowed' });
    expect(JSON.stringify([log.warn.mock.calls, log.info.mock.calls])).not.toContain('hunter2');
  });

  it('limits frames to 5 and inputs to 20 per second per login', async () => {
    const { service } = setup();
    const { loginId } = await service.start(ACCOUNT, 'UTC', ACTOR);
    for (let i = 0; i < 5; i += 1) service.frame(ACCOUNT, loginId);
    expect(() => service.frame(ACCOUNT, loginId)).toThrowError(
      expect.objectContaining({ code: 'remote_login_rate_limited' }),
    );
    vi.advanceTimersByTime(1_001);
    expect(() => service.frame(ACCOUNT, loginId)).not.toThrow();
    for (let i = 0; i < 20; i += 1) {
      await service.input(ACCOUNT, loginId, { type: 'key', key: 'Tab' });
    }
    await expect(service.input(ACCOUNT, loginId, { type: 'key', key: 'Tab' })).rejects.toMatchObject({
      code: 'remote_login_rate_limited',
    });
  });

  it('marks the account ready on /feed and closes the browser after 5 seconds', async () => {
    const { service, fake, onSignedIn, profile } = setup();
    const { loginId } = await service.start(ACCOUNT, 'UTC', ACTOR);
    fake.navigate('https://www.linkedin.com/feed/');
    expect(service.frame(ACCOUNT, loginId).state).toBe('signed_in');
    expect(fake.context.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onSignedIn).toHaveBeenCalledWith(
      ACCOUNT,
      [{ name: 'li_at', value: 'secret-cookie-value' }],
      ACTOR,
    );
    expect(fake.context.close).toHaveBeenCalledTimes(1);
    expect(existsSync(join(profile, '.lock'))).toBe(false);
    expect(service.frame(ACCOUNT, loginId).state).toBe('signed_in');
  });

  it('closes an idle login after 10 minutes and frees the profile', async () => {
    const { service, fake, profile } = setup();
    const { loginId } = await service.start(ACCOUNT, 'UTC', ACTOR);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(fake.context.close).toHaveBeenCalledTimes(1);
    expect(service.frame(ACCOUNT, loginId)).toMatchObject({ state: 'closed', reason: 'idle' });
    expect(existsSync(join(profile, '.lock'))).toBe(false);
    await expect(service.start(ACCOUNT, 'UTC', ACTOR)).resolves.toBeDefined();
  });

  it('closes on request and ignores the second close', async () => {
    const { service, fake } = setup();
    const { loginId } = await service.start(ACCOUNT, 'UTC', ACTOR);
    await service.close(ACCOUNT, loginId);
    await service.close(ACCOUNT, loginId);
    expect(fake.context.close).toHaveBeenCalledTimes(1);
    expect(service.frame(ACCOUNT, loginId)).toMatchObject({ state: 'closed', reason: 'closed_by_admin' });
  });

  it('fails clean when the browser cannot start and releases the lock', async () => {
    const { service, launchContext, profile } = setup();
    launchContext.mockRejectedValueOnce(new Error('no chromium'));
    await expect(service.start(ACCOUNT, 'UTC', ACTOR)).rejects.toMatchObject({
      code: 'remote_login_unavailable',
    });
    expect(existsSync(join(profile, '.lock'))).toBe(false);
  });
});
