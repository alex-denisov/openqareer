// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../../kit/testDom';
import { POOL_RETRY_DELAY_MS, usePoolRetry } from './usePoolRetry';

function Probe({ failed, refresh }: { failed: boolean; refresh: () => void }) {
  const retrying = usePoolRetry({ failed, refresh });
  return <output data-retrying={String(retrying)} />;
}

describe('usePoolRetry: один повтор чтения подборки', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('после первого сбоя ждёт паузу и перечитывает один раз', () => {
    const refresh = vi.fn();
    const view = mount(<Probe failed refresh={refresh} />);
    const state = () => view.container.querySelector('output')?.getAttribute('data-retrying');
    expect(state()).toBe('true');
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(POOL_RETRY_DELAY_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(state()).toBe('false');
    act(() => vi.advanceTimersByTime(POOL_RETRY_DELAY_MS * 3));
    expect(refresh).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('в StrictMode повтор тоже срабатывает один раз', () => {
    const refresh = vi.fn();
    const view = mount(
      <StrictMode>
        <Probe failed refresh={refresh} />
      </StrictMode>,
    );
    act(() => vi.advanceTimersByTime(POOL_RETRY_DELAY_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('output')?.getAttribute('data-retrying')).toBe('false');
    view.unmount();
  });

  it('без сбоя ничего не делает', () => {
    const refresh = vi.fn();
    const view = mount(<Probe failed={false} refresh={refresh} />);
    act(() => vi.advanceTimersByTime(POOL_RETRY_DELAY_MS * 2));
    expect(refresh).not.toHaveBeenCalled();
    expect(view.container.querySelector('output')?.getAttribute('data-retrying')).toBe('false');
    view.unmount();
  });
});
