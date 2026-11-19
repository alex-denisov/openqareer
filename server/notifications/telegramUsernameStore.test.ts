import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SealedText } from '../data/sealedText';
import { normalizeTelegramUsername, SqliteTelegramUsernameStore, telegramLinkState } from './telegramUsernameStore';

const sealed = new SealedText(Buffer.alloc(32, 7));

describe('telegram username store', () => {
  it('keeps the name sealed, reads it back, replaces and forgets it', () => {
    const database = new DatabaseSync(':memory:');
    const store = new SqliteTelegramUsernameStore(database, sealed);
    store.save('c1', 'msokolova_dev', '2026-11-19T10:00:00.000Z');
    expect(store.get('c1')).toBe('msokolova_dev');
    expect(JSON.stringify(database.prepare('SELECT * FROM candidate_telegram_usernames').all())).not.toContain('msokolova');
    store.save('c1', 'other_name', '2026-11-19T11:00:00.000Z');
    expect(store.get('c1')).toBe('other_name');
    store.remove('c1');
    expect(store.get('c1')).toBeNull();
    expect(store.get('c2')).toBeNull();
    store.close();
    database.close();
  });

  it('accepts only real Telegram usernames', () => {
    expect(normalizeTelegramUsername('MSokolova_dev')).toBe('MSokolova_dev');
    expect(normalizeTelegramUsername('@msokolova')).toBe('msokolova');
    expect(normalizeTelegramUsername('abc')).toBeNull();
    expect(normalizeTelegramUsername('1startsdigit')).toBeNull();
    expect(normalizeTelegramUsername('has space')).toBeNull();
    expect(normalizeTelegramUsername(undefined)).toBeNull();
    expect(normalizeTelegramUsername('a'.repeat(33))).toBeNull();
  });
});

describe('telegramLinkState', () => {
  const now = '2026-11-19T10:00:00.000Z';
  it('is connected when a chat is linked, whatever the code', () => {
    expect(telegramLinkState({ connected: true, codeExpiresAt: '2026-11-19T10:05:00.000Z', now })).toEqual({ state: 'connected', expiresAt: null });
  });
  it('waits while the link is fresh and says it went stale after its term', () => {
    expect(telegramLinkState({ connected: false, codeExpiresAt: '2026-11-19T10:05:00.000Z', now })).toEqual({
      state: 'waiting',
      expiresAt: '2026-11-19T10:05:00.000Z',
    });
    expect(telegramLinkState({ connected: false, codeExpiresAt: '2026-11-19T09:59:59.000Z', now })).toEqual({ state: 'expired', expiresAt: null });
  });
  it('is none without a link or a chat', () => {
    expect(telegramLinkState({ connected: false, codeExpiresAt: null, now })).toEqual({ state: 'none', expiresAt: null });
  });
});
