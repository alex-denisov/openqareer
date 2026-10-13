import { describe, expect, it } from 'vitest';
import { createNotificationUnsubscribeToken } from './notificationToken';

describe('notification unsubscribe token', () => {
  it('is stable for one candidate and scoped by the server secret and candidate id', () => {
    const key = Buffer.alloc(32, 5);
    const token = createNotificationUnsubscribeToken('candidate-a', key);

    expect(token).toHaveLength(43);
    expect(createNotificationUnsubscribeToken('candidate-a', key)).toBe(token);
    expect(createNotificationUnsubscribeToken('candidate-b', key)).not.toBe(token);
    expect(createNotificationUnsubscribeToken('candidate-a', Buffer.alloc(32, 6))).not.toBe(token);
  });
});
