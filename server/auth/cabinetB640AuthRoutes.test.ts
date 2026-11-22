import { describe, expect, it } from 'vitest';
import { createApp, login } from './authRoutesTestSupport';

const PASSWORD = 'candidate-password-for-tests';

function appWithFlag(usernames?: readonly string[]) {
  return createApp(undefined, undefined, undefined, {}, usernames ? { cabinetB640Usernames: usernames } : {});
}

async function me(app: Awaited<ReturnType<typeof createApp>>, cookie: string) {
  const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
  return response.json().data;
}

describe('cabinet B640 flag in auth responses (B649)', () => {
  it('reports the flag as off for every account by default', async () => {
    const app = await appWithFlag();
    const candidate = await login(app, 'candidate.test', PASSWORD);

    expect(candidate.response.json().data.features).toEqual({ cabinetB640: false, interviewRecording: false });
    expect((await me(app, candidate.cookie)).features).toEqual({ cabinetB640: false, interviewRecording: false });
  });

  it('turns the flag on only for the listed sign-in name', async () => {
    const app = await appWithFlag(['candidate.test']);
    const candidate = await login(app, 'candidate.test', PASSWORD);
    const admin = await login(app, 'admin.test', 'admin-password-for-tests');

    expect(candidate.response.json().data.features).toEqual({ cabinetB640: true, interviewRecording: false });
    expect((await me(app, candidate.cookie)).features).toEqual({ cabinetB640: true, interviewRecording: false });
    expect(admin.response.json().data.features).toEqual({ cabinetB640: false, interviewRecording: false });
    expect((await me(app, admin.cookie)).features).toEqual({ cabinetB640: false, interviewRecording: false });
  });

  it('turns the flag on for everyone with the wildcard', async () => {
    const app = await appWithFlag(['*']);
    const admin = await login(app, 'admin.test', 'admin-password-for-tests');

    expect((await me(app, admin.cookie)).features).toEqual({ cabinetB640: true, interviewRecording: false });
  });

  it('never exposes the list of sign-in names', async () => {
    const app = await appWithFlag(['candidate.test', 'someone.else']);
    const admin = await login(app, 'admin.test', 'admin-password-for-tests');
    const body = JSON.stringify(await me(app, admin.cookie));

    expect(body).not.toContain('someone.else');
    expect(body).not.toContain('candidate.test');
  });

  it('keeps the anonymous answer unchanged', async () => {
    const app = await appWithFlag(['*']);
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.json().data).toBeNull();
  });
});
