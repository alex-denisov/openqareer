// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  LINKEDIN_CONNECTIONS_URL,
  importLinkedInConnectionsFromSession,
} from './linkedinConnectionsImport';

const body = readFileSync(join(__dirname, '__fixtures__/linkedin/connections.html'), 'utf8');

function throttle(last?: number) {
  return { lastReadAt: () => last, markRead: vi.fn() };
}

describe('LinkedIn connections import from the session (B448)', () => {
  it('reads the connections page and uploads every contact', async () => {
    const readSessionPage = vi
      .fn()
      .mockResolvedValue({ ok: true, body, url: LINKEDIN_CONNECTIONS_URL });
    const upload = vi.fn().mockResolvedValue({ state: 'imported' });

    const outcome = await importLinkedInConnectionsFromSession({
      readSessionPage,
      upload,
      throttle: throttle(),
    });

    expect(readSessionPage).toHaveBeenCalledWith(LINKEDIN_CONNECTIONS_URL);
    expect(outcome).toEqual({ status: 'uploading', count: 4, parsed: 4, withCompany: 3 });
    expect(upload).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ companyName: 'Север Тех' })]),
    );
  });

  it('skips the read inside the 12 h window', async () => {
    const readSessionPage = vi.fn();
    const outcome = await importLinkedInConnectionsFromSession({
      readSessionPage,
      upload: vi.fn(),
      throttle: throttle(Date.now() - 60_000),
    });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'recently_read' });
    expect(readSessionPage).not.toHaveBeenCalled();
  });

  it('does not upload when the read lands somewhere else', async () => {
    const upload = vi.fn();
    const outcome = await importLinkedInConnectionsFromSession({
      readSessionPage: vi.fn().mockResolvedValue({
        ok: true,
        body,
        url: 'https://www.linkedin.com/checkpoint/challenge/',
      }),
      upload,
      throttle: throttle(),
    });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'not_connections_page' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('never throws: a failed read or upload ends quietly', async () => {
    const outcome = await importLinkedInConnectionsFromSession({
      readSessionPage: vi.fn().mockRejectedValue(new Error('page_load_timeout')),
      upload: vi.fn(),
      throttle: throttle(),
    });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'read_failed' });

    const rejected = vi.fn().mockRejectedValue(new Error('500'));
    const uploading = await importLinkedInConnectionsFromSession({
      readSessionPage: vi.fn().mockResolvedValue({ ok: true, body, url: LINKEDIN_CONNECTIONS_URL }),
      upload: rejected,
      throttle: throttle(),
    });
    expect(uploading.status).toBe('uploading');
    await Promise.resolve();
  });

  it('saves the page locally when it yields no contacts, so the parser can be tuned', async () => {
    const saveCaptureDump = vi.fn().mockResolvedValue(undefined);
    const upload = vi.fn();
    const page = '<main><div>Unknown layout</div></main>';
    const outcome = await importLinkedInConnectionsFromSession({
      readSessionPage: vi
        .fn()
        .mockResolvedValue({ ok: true, body: page, url: LINKEDIN_CONNECTIONS_URL }),
      upload,
      saveCaptureDump,
      throttle: throttle(),
    });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'no_contacts' });
    expect(saveCaptureDump).toHaveBeenCalledWith(page);
    expect(upload).not.toHaveBeenCalled();
  });

  it('does not save a page that yielded contacts', async () => {
    const saveCaptureDump = vi.fn();
    await importLinkedInConnectionsFromSession({
      readSessionPage: vi.fn().mockResolvedValue({ ok: true, body, url: LINKEDIN_CONNECTIONS_URL }),
      upload: vi.fn().mockResolvedValue({}),
      saveCaptureDump,
      throttle: throttle(),
    });
    expect(saveCaptureDump).not.toHaveBeenCalled();
  });
});
