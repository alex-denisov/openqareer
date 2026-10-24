import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeCandidateWorkspace } from './workspaceCompletionApi';

const workspace = { resumeText: '', resumeSource: 'text' as const, targetDirection: 'Analyst',
  regions: [], currentSituation: '', constraints: '', urgency: 'active' as const };

afterEach(() => vi.unstubAllGlobals());

describe('explicit workspace completion API', () => {
  it('uses only the explicit completion POST with the actual saved answers', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: workspace }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(completeCandidateWorkspace(workspace)).resolves.toEqual(workspace);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/candidate/workspace/complete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ workspace });
  });

  it('rejects server failure without a success fallback or ordinary PUT', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'unavailable', message: 'Unavailable' } }), { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(completeCandidateWorkspace(workspace)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
