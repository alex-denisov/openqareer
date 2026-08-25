import { describe, expect, it, vi } from 'vitest';
import { captureSignedInPage } from './sessionCapture';

const noWait = async () => {};
const anyPage = (page: { readonly body: string; readonly url?: string }) => page;

describe('capturing a page after the sign-in is already recognised', () => {
  it('returns the first usable read without waiting', async () => {
    const read = vi.fn(async () => ({ ok: true, url: 'https://hh.ru/x', body: 'ok' }));
    const waitBeforeRetry = vi.fn(async () => {});

    await expect(
      captureSignedInPage({
        read,
        interpret: anyPage,
        failureCode: 'capture_failed',
        waitBeforeRetry,
      }),
    ).resolves.toMatchObject({ body: 'ok', url: 'https://hh.ru/x' });
    expect(waitBeforeRetry).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'a read that failed', page: { ok: false } },
    { name: 'a read with no body', page: { ok: true, url: 'https://hh.ru/x' } },
  ])('retries $name rather than losing the session', async ({ page }) => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(page)
      .mockResolvedValue({ ok: true, url: 'https://hh.ru/x', body: 'ok' });

    await expect(
      captureSignedInPage({
        read,
        interpret: anyPage,
        failureCode: 'capture_failed',
        waitBeforeRetry: noWait,
      }),
    ).resolves.toMatchObject({ body: 'ok' });
  });

  it('retries a read that threw a transient desktop error', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('page_load_timeout'))
      .mockResolvedValue({ ok: true, url: 'https://hh.ru/x', body: 'ok' });

    await expect(
      captureSignedInPage({
        read,
        interpret: anyPage,
        failureCode: 'capture_failed',
        waitBeforeRetry: noWait,
      }),
    ).resolves.toMatchObject({ body: 'ok' });
  });

  it('retries a response that is not the page the flow asked for', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, url: 'https://hh.ru/other', body: 'nope' })
      .mockResolvedValue({ ok: true, url: 'https://hh.ru/wanted', body: 'ok' });

    await expect(
      captureSignedInPage({
        read,
        interpret: (page) => (page.url === 'https://hh.ru/wanted' ? page : undefined),
        failureCode: 'capture_failed',
        waitBeforeRetry: noWait,
      }),
    ).resolves.toMatchObject({ body: 'ok' });
  });

  it('backs off between attempts, growing the wait', async () => {
    const waits: number[] = [];
    const read = vi.fn(async () => ({ ok: false }));

    await expect(
      captureSignedInPage({
        read,
        interpret: anyPage,
        failureCode: 'capture_failed',
        waitBeforeRetry: async (attempt) => {
          waits.push(attempt);
        },
      }),
    ).rejects.toThrow('capture_failed');
    expect(read).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1, 2]);
  });

  it('stops immediately when the platform is challenging the candidate', async () => {
    const read = vi.fn(async () => ({
      ok: true,
      url: 'https://hh.ru/x',
      body: 'captcha',
    }));

    await expect(
      captureSignedInPage({
        read,
        interpret: anyPage,
        isChallenge: (body) => body.includes('captcha'),
        failureCode: 'capture_failed',
        waitBeforeRetry: noWait,
      }),
    ).rejects.toThrow('capture_failed');
    expect(read).toHaveBeenCalledOnce();
  });

  it('waits without a real timer only when one is injected', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true, url: 'https://hh.ru/x', body: 'ok' });
    const started = Date.now();

    await expect(
      captureSignedInPage({ read, interpret: anyPage, failureCode: 'capture_failed' }),
    ).resolves.toMatchObject({ body: 'ok' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
  });
});
