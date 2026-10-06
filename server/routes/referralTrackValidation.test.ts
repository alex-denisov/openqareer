import { describe, expect, it } from 'vitest';
import { putReferralTrackSchema } from './referralTrackValidation';

describe('putReferralTrackSchema', () => {
  it('принимает выбор контакта с минимумом полей и простые действия', () => {
    expect(
      putReferralTrackSchema.safeParse({ action: 'select', contact: { name: 'Анна' } }).success,
    ).toBe(true);
    expect(putReferralTrackSchema.safeParse({ action: 'candidate_sent_request' }).success).toBe(true);
    expect(
      putReferralTrackSchema.safeParse({ action: 'record_reply', outcome: 'declined' }).success,
    ).toBe(true);
  });

  it('отклоняет пустое имя, не-https ссылку, пустой питч и неизвестное действие', () => {
    const select = (contact: unknown) => putReferralTrackSchema.safeParse({ action: 'select', contact });
    expect(select({ name: ' ' }).success).toBe(false);
    expect(select({ name: 'Анна', profileUrl: 'http://x.test/a' }).success).toBe(false);
    expect(putReferralTrackSchema.safeParse({ action: 'draft_pitch', pitch: ' ' }).success).toBe(false);
    expect(putReferralTrackSchema.safeParse({ action: 'send' }).success).toBe(false);
  });
});
