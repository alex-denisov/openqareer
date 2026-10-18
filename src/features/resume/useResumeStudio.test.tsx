// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import type { ResumeDraft, ResumeStudioView } from './resumeTypes';
import { previewProjection } from './resumeStudioModel';
import { useResumeStudio } from './useResumeStudio';

function viewOf(draft: ResumeDraft | null): ResumeStudioView {
  return {
    draft,
    savedAt: null,
    projection: previewProjection(draft ?? EMPTY_RESUME_DRAFT, []),
    evidenceFreshness: { valid: true, stale: [] },
  };
}

const mounted: Array<{
  readonly root: ReturnType<typeof createRoot>;
  readonly container: HTMLElement;
}> = [];

function renderHook(onSaved = vi.fn()) {
  let state: ReturnType<typeof useResumeStudio> | undefined;
  function Harness() {
    state = useResumeStudio(onSaved);
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  return {
    onSaved,
    read: () => state!,
    render: () => act(() => root.render(<Harness />)),
  };
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useResumeStudio empty GET response', () => {
  it('normalizes a successful null draft to the canonical empty draft and saves the first edit', async () => {
    const editedDraft: ResumeDraft = {
      ...EMPTY_RESUME_DRAFT,
      candidate: { fullName: 'Надежда' },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/api/v1/candidate/resume');
      if (init?.method === 'PUT') {
        expect(JSON.parse(String(init.body)).candidate.fullName).toBe('Надежда');
        return new Response(JSON.stringify({ data: viewOf(editedDraft) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: viewOf(null) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook();

    await act(async () => {
      hook.render();
      await Promise.resolve();
    });

    expect(hook.read().loading).toBe(false);
    expect(hook.read().error).toBeUndefined();
    expect(hook.read().draft).toEqual(EMPTY_RESUME_DRAFT);

    let saved = false;
    await act(async () => {
      saved = await hook.read().save(editedDraft);
    });

    expect(saved).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const saveRequest = fetchMock.mock.calls[1]?.[1];
    expect(saveRequest?.method).toBe('PUT');
    const savedPayload = JSON.parse(String(saveRequest?.body));
    expect(savedPayload.candidate.fullName).toBe('Надежда');
    expect(savedPayload.schemaVersion).toBe(2);
    expect(hook.read().draft).toEqual(editedDraft);
    expect(hook.onSaved).toHaveBeenCalledOnce();
  });

  it('keeps a failed initial GET as an error instead of converting it to an empty draft', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const hook = renderHook();

    await act(async () => {
      hook.render();
      await Promise.resolve();
    });

    expect(hook.read().loading).toBe(false);
    expect(hook.read().draft).toBeUndefined();
    expect(hook.read().error).toBeDefined();
  });
});
