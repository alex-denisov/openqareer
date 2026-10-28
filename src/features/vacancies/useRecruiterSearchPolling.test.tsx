// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecruiterSearchPolling } from './useRecruiterSearchPolling';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ status, reload }: { status: string | undefined; reload: () => void }) {
  useRecruiterSearchPolling(status, reload);
  return null;
}

afterEach(() => vi.useRealTimers());

describe('useRecruiterSearchPolling (макет 13, 28.10)', () => {
  it('re-reads the company while the recruiter search is queued or running, then stops', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe status="queued" reload={reload} />));
    act(() => vi.advanceTimersByTime(3_000));
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => root.render(<Probe status="running" reload={reload} />));
    act(() => vi.advanceTimersByTime(3_000));
    expect(reload).toHaveBeenCalledTimes(2);
    act(() => root.render(<Probe status="ready" reload={reload} />));
    act(() => vi.advanceTimersByTime(30_000));
    expect(reload).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });
});
