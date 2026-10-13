import { describe, expect, it } from 'vitest';
import { redactRequestUrlForLogs } from './app';

describe('request URL log redaction', () => {
  it('preserves route context while redacting bearer values in query strings', () => {
    const redacted = redactRequestUrlForLogs(
      '/api/v1/candidate/notifications/unsubscribe?token=private-token&view=settings',
    );

    expect(redacted).toContain('/api/v1/candidate/notifications/unsubscribe');
    expect(redacted).toContain('view=settings');
    expect(redacted).not.toContain('private-token');
  });

  it('redacts full URLs and malformed URL values safely', () => {
    expect(redactRequestUrlForLogs('https://example.test/path?code=private-code')).toContain(
      '/path?code=',
    );
    expect(redactRequestUrlForLogs({ token: 'private-token' })).toBe('[REDACTED]');
  });
});
