import { afterEach, describe, expect, it, vi } from 'vitest';
import { getResumeStudio, saveResumeStudioDraft } from './resumeApi';
import { getResumeVersions } from './resumeVersionsApi';
import { apiFetch } from '../coach/apiClient';
import { forgetAllSharedReads } from './sharedRead';

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string) =>
      new Response(JSON.stringify({ data: body }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('one read per Profile open (CPO prod, 02.11: /resume ×4, versions ×2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    forgetAllSharedReads();
  });

  it('shares one /resume request between callers that ask at the same time', async () => {
    const fetchMock = stubFetch({ draft: {} });
    const reads = await Promise.all([getResumeStudio(), getResumeStudio(), getResumeStudio()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reads[0]).toBe(reads[2]);
  });

  it('does not hand a read started before a save to a caller after it', async () => {
    const fetchMock = stubFetch({ draft: {} });
    const before = getResumeStudio();
    await saveResumeStudioDraft({} as never).catch(() => undefined);
    const after = getResumeStudio();
    await Promise.all([before, after]);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/candidate/resume')).length,
    ).toBe(3);
  });

  it('shares one versions page between callers with the same query', async () => {
    const page = { items: [], nextCursor: null, totalCount: 0, currentMasterRevision: 'm' };
    const fetchMock = stubFetch(page);
    const first = new AbortController();
    const [a, b] = await Promise.all([
      getResumeVersions({ limit: 50, signal: first.signal }),
      getResumeVersions({ limit: 50 }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('an aborted caller does not cancel the shared versions read for the other', async () => {
    const page = { items: [], nextCursor: null, totalCount: 0, currentMasterRevision: 'm' };
    stubFetch(page);
    const first = new AbortController();
    const aborted = getResumeVersions({ limit: 50, signal: first.signal });
    const kept = getResumeVersions({ limit: 50 });
    first.abort();
    await expect(aborted).rejects.toThrow();
    await expect(kept).resolves.toEqual(page);
  });

  it('one Profile open reads /resume once although its parts ask seconds apart (CPO prod 02.11: ×3)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchMock = stubFetch({ draft: {} });
    await getResumeStudio();
    vi.setSystemTime(Date.now() + 3_000);
    await getResumeStudio();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 20_000);
    await getResumeStudio();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('any write drops the kept read, so a refresh after it reads the new profile', async () => {
    const fetchMock = stubFetch({ draft: {} });
    await getResumeStudio();
    await apiFetch('/api/v1/candidate/resume/experience/x/confirm', { method: 'POST', body: '{}' });
    await getResumeStudio();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/candidate/resume')).length,
    ).toBe(2);
  });
});
