import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getProfileAtsAssessment,
  getResumeAtsAssessment,
  getResumeVersions,
} from './resumeVersionsApi';

function respond(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
    ),
  );
}

describe('getResumeVersions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects an empty page instead of handing `null` to the list', async () => {
    respond({ data: null });
    await expect(getResumeVersions()).rejects.toThrow();
  });

  it('rejects a page without an items array', async () => {
    respond({ data: { nextCursor: null, totalCount: 0, currentMasterRevision: 'm' } });
    await expect(getResumeVersions()).rejects.toThrow();
  });

  it('returns a well-formed page', async () => {
    const page = { items: [], nextCursor: null, totalCount: 0, currentMasterRevision: 'm' };
    respond({ data: page });
    await expect(getResumeVersions()).resolves.toEqual(page);
  });
});

describe('getResumeAtsAssessment', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects a response without an assessment as malformed, not a TypeError (B536)', async () => {
    respond({});
    await expect(getResumeAtsAssessment({})).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('rejects data without an assessment object (B536)', async () => {
    respond({ data: { assessment: null } });
    await expect(getResumeAtsAssessment({})).rejects.toMatchObject({ code: 'malformed_response' });
  });
});

describe('getProfileAtsAssessment', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts an empty body so the server picks the version and role', async () => {
    const assessment = { total: { score: 70, maximum: 100, status: 'measured' } };
    const basis = { version: null, roleTitle: 'CTO' };
    respond({ data: { assessment, basis } });
    await expect(getProfileAtsAssessment()).resolves.toEqual({ assessment, basis });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('/api/v1/candidate/resume/ats-assessment');
    expect(init?.body).toBe('{}');
  });

  it('reads a missing basis as «nothing picked» and a missing assessment as malformed', async () => {
    const assessment = { total: { score: null, maximum: 100, status: 'partial' } };
    respond({ data: { assessment } });
    await expect(getProfileAtsAssessment()).resolves.toEqual({
      assessment,
      basis: { version: null, roleTitle: null },
    });
    respond({ data: { basis: null } });
    await expect(getProfileAtsAssessment()).rejects.toMatchObject({ code: 'malformed_response' });
  });
});
