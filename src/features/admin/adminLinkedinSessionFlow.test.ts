import { describe, expect, it } from 'vitest';
import { isClosedSessionWindow, transferFailureCopy } from './adminLinkedinSessionFlow';

describe('isClosedSessionWindow (B325)', () => {
  it('treats the Tauri missing-window rejection as a closed window', () => {
    expect(isClosedSessionWindow('session_window_missing')).toBe(true);
    expect(isClosedSessionWindow(new Error('session_window_missing'))).toBe(true);
  });

  it('keeps other inspection failures as failures', () => {
    expect(isClosedSessionWindow('eval_timeout')).toBe(false);
    expect(isClosedSessionWindow(new Error('inspection_shape: bad'))).toBe(false);
  });
});

describe('transferFailureCopy (B325)', () => {
  it('names a known desktop reason', () => {
    expect(transferFailureCopy('linkedin_session_cookie_required')).toContain('li_at');
  });

  it('keeps an unknown reason code visible', () => {
    expect(transferFailureCopy(new Error('eval_timeout'))).toContain('eval_timeout');
  });
});
