import { describe, expect, it, vi } from 'vitest';
import { createEmailDomainChecker, type EmailDomainResolver } from './emailDomainCheck';

function dnsError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function resolver(overrides: Partial<EmailDomainResolver> = {}): EmailDomainResolver {
  return {
    resolveMx: async () => [{ exchange: 'mx.mail.test', priority: 10 }],
    resolve4: async () => [],
    resolve6: async () => [],
    ...overrides,
  };
}

describe('email domain DNS validation', () => {
  it('rejects a domain without MX, A or AAAA records', async () => {
    const check = createEmailDomainChecker({
      resolver: resolver({
        resolveMx: async () => {
          throw dnsError('ENODATA');
        },
        resolve4: async () => {
          throw dnsError('ENODATA');
        },
        resolve6: async () => {
          throw dnsError('ENODATA');
        },
      }),
      bypassDomains: [],
    });

    await expect(check('candidate@missing.test')).resolves.toBe('unreachable');
  });

  it('accepts an A-only domain as an implicit MX', async () => {
    const resolve6 = vi.fn(async () => []);
    const check = createEmailDomainChecker({
      resolver: resolver({
        resolveMx: async () => {
          throw dnsError('ENODATA');
        },
        resolve4: async () => ['192.0.2.10'],
        resolve6,
      }),
      bypassDomains: [],
    });

    await expect(check('candidate@a-only.test')).resolves.toBe('reachable');
    expect(resolve6).not.toHaveBeenCalled();
  });

  it('rejects a domain that publishes a null MX record', async () => {
    const resolve4 = vi.fn(async () => ['192.0.2.10']);
    const check = createEmailDomainChecker({
      resolver: resolver({ resolveMx: async () => [{ exchange: '.', priority: 0 }], resolve4 }),
      bypassDomains: [],
    });

    await expect(check('candidate@null-mx.test')).resolves.toBe('unreachable');
    expect(resolve4).not.toHaveBeenCalled();
  });

  it('fails open and records a DNS failure', async () => {
    const onDnsFailure = vi.fn();
    const check = createEmailDomainChecker({
      resolver: resolver({
        resolveMx: async () => {
          throw dnsError('ESERVFAIL');
        },
      }),
      bypassDomains: [],
      onDnsFailure,
    });

    await expect(check('candidate@temporary-failure.test')).resolves.toBe('unavailable');
    expect(onDnsFailure).toHaveBeenCalledWith({ code: 'ESERVFAIL' });
  });

  it('fails open on DNS timeout and records the timeout', async () => {
    const onDnsFailure = vi.fn();
    const check = createEmailDomainChecker({
      resolver: resolver({ resolveMx: () => new Promise(() => {}) }),
      bypassDomains: [],
      timeoutMs: 10,
      onDnsFailure,
    });

    await expect(check('candidate@slow-dns.test')).resolves.toBe('unavailable');
    expect(onDnsFailure).toHaveBeenCalledWith({ code: 'DNS_TIMEOUT' });
  });

  it('bypasses configured domains without resolving them', async () => {
    const resolveMx = vi.fn(async () => [{ exchange: 'mx.mail.test', priority: 10 }]);
    const check = createEmailDomainChecker({
      resolver: resolver({ resolveMx }),
      bypassDomains: ['example.com', 'test'],
    });

    await expect(check('candidate@example.com')).resolves.toBe('bypassed');
    await expect(check('candidate@fixture.test')).resolves.toBe('bypassed');
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it('caches positive and negative results with their separate TTLs', async () => {
    let now = 0;
    const resolveMx = vi.fn(async (domain: string) => {
      if (domain === 'missing.test') throw dnsError('ENODATA');
      return [{ exchange: 'mx.mail.test', priority: 10 }];
    });
    const resolve4 = vi.fn(async () => {
      throw dnsError('ENODATA');
    });
    const resolve6 = vi.fn(async () => {
      throw dnsError('ENODATA');
    });
    const check = createEmailDomainChecker({
      resolver: resolver({ resolveMx, resolve4, resolve6 }),
      bypassDomains: [],
      now: () => now,
    });

    await check('a@reachable.test');
    await check('b@reachable.test');
    expect(resolveMx).toHaveBeenCalledTimes(1);
    now = 3_600_001;
    await check('c@reachable.test');
    expect(resolveMx).toHaveBeenCalledTimes(2);

    await check('a@missing.test');
    await check('b@missing.test');
    expect(resolve4).toHaveBeenCalledTimes(1);
    expect(resolve6).toHaveBeenCalledTimes(1);
    now += 300_001;
    await check('c@missing.test');
    expect(resolve4).toHaveBeenCalledTimes(2);
    expect(resolve6).toHaveBeenCalledTimes(2);
  });

  it('bounds the number of cached domains', async () => {
    const resolveMx = vi.fn(async () => [{ exchange: 'mx.mail.test', priority: 10 }]);
    const check = createEmailDomainChecker({
      resolver: resolver({ resolveMx }),
      bypassDomains: [],
      maxCacheEntries: 1,
    });

    await check('a@first.test');
    await check('a@second.test');
    await check('a@first.test');

    expect(resolveMx).toHaveBeenCalledTimes(3);
  });
});
