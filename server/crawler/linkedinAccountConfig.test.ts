import { describe, expect, it } from 'vitest';
import { configuredLinkedinAccountIds, linkedinCredentialBlock } from './linkedinAccountConfig';

describe('linkedinAccountConfig', () => {
  it('derives account IDs from credential blocks without exposing values', () => {
    const env = {
      LINKEDIN_01_LOGIN: 'first@example.test',
      LINKEDIN_03_LOGIN: 'third@example.test',
      LINKEDIN_03_PASSWORD: 'secret',
    } as NodeJS.ProcessEnv;

    expect(configuredLinkedinAccountIds(env)).toEqual(['account-1', 'account-3']);
    expect(linkedinCredentialBlock('account-3', env)).toEqual({
      login: 'third@example.test',
      password: 'secret',
      twoFactorKey: undefined,
      emailLogin: undefined,
      emailPassword: undefined,
      profileUrl: undefined,
    });
  });

  it('prefers explicit pool IDs over discovered credential blocks', () => {
    const env = {
      LINKEDIN_ACCOUNT_IDS: 'account-2, account-5',
      LINKEDIN_01_LOGIN: 'ignored@example.test',
    } as NodeJS.ProcessEnv;

    expect(configuredLinkedinAccountIds(env)).toEqual(['account-2', 'account-5']);
  });
});
