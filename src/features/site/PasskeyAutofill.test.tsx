// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  supported: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  options: vi.fn(),
  login: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthnAutofill: api.supported,
  startAuthentication: api.start,
  WebAuthnAbortService: { cancelCeremony: api.cancel },
}));
vi.mock('../coach/passkeyLoginApi', () => ({
  fetchPasskeyLoginOptions: api.options,
  loginWithPasskey: api.login,
}));

import type { AuthUser } from '../coach/coachApi';
import { usePasskeyAutofill } from './usePasskeyAutofill';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = { username: 'f.test', role: 'candidate' } as AuthUser;
let root: Root | null = null;
let host: HTMLDivElement;

function Probe({
  onSignedIn,
  enabled = true,
}: {
  onSignedIn: (user: AuthUser) => void;
  enabled?: boolean;
}) {
  usePasskeyAutofill(onSignedIn, enabled);
  return null;
}

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function render(onSignedIn = vi.fn(), enabled = true) {
  root = createRoot(host);
  act(() => root?.render(<Probe onSignedIn={onSignedIn} enabled={enabled} />));
  await settle();
  return onSignedIn;
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  api.supported.mockResolvedValue(true);
  api.options.mockResolvedValue({ options: { challenge: 'abc' }, token: 'oqp_token' });
  api.start.mockResolvedValue({ id: 'cred' });
  api.login.mockResolvedValue(user);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe('B755: вход ключом в поле почты', () => {
  it('asks the browser for a key through autofill, posts it and signs in', async () => {
    const onSignedIn = await render();
    expect(api.start).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'abc' },
      useBrowserAutofill: true,
    });
    expect(api.login).toHaveBeenCalledWith('oqp_token', { id: 'cred' });
    expect(onSignedIn).toHaveBeenCalledWith(user);
  });

  it('is silent and makes no request where autofill is not supported', async () => {
    api.supported.mockResolvedValue(false);
    const onSignedIn = await render();
    expect(api.options).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('stays silent when the key is declined or the server refuses', async () => {
    api.start.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    expect(await render()).not.toHaveBeenCalled();
    expect(api.login).not.toHaveBeenCalled();
    act(() => root?.unmount());
    api.start.mockResolvedValue({ id: 'cred' });
    api.login.mockRejectedValue(new Error('401'));
    expect(await render()).not.toHaveBeenCalled();
  });

  it('does nothing while the page is still inert', async () => {
    await render(vi.fn(), false);
    expect(api.supported).not.toHaveBeenCalled();
  });

  it('cancels the pending ceremony on unmount and ignores a late answer', async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.start.mockReturnValue(new Promise((done) => (finish = done)));
    const onSignedIn = await render();
    act(() => root?.unmount());
    expect(api.cancel).toHaveBeenCalled();
    finish({ id: 'cred' });
    await settle();
    expect(api.login).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
