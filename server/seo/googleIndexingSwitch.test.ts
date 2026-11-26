import { describe, expect, it } from 'vitest';
import { googleIndexingKey } from './googleIndexingSwitch';

describe('googleIndexingKey (11.11)', () => {
  it('stays off unless explicitly enabled: Google drops our notifications unapproved', () => {
    expect(googleIndexingKey({ OPENQAREER_GSC_SERVICE_ACCOUNT_B64: 'k' })).toBeUndefined();
    expect(
      googleIndexingKey({
        OPENQAREER_GSC_SERVICE_ACCOUNT_B64: 'k',
        OPENQAREER_GOOGLE_INDEXING_ENABLED: '1',
      }),
    ).toBe('k');
  });
});
