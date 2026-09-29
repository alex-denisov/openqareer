import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CONSENTS_APPROVED,
  CAPABILITY_CONSENT_DOCUMENTS,
  CANDIDATE_CAPABILITIES,
  isCandidateCapability,
} from '../../src/features/legal/capabilityConsents';
import {
  purgeExpiredCapabilityConsents,
  SqliteCapabilityConsentStore,
} from './capabilityConsentStore';


describe('capabilityConsents draft text and flags', () => {
  it('keeps approval flag false until owner visual acceptance', () => {
    expect(CAPABILITY_CONSENTS_APPROVED).toBe(false);
  });

  it('defines 3 closed candidate capabilities', () => {
    expect(CANDIDATE_CAPABILITIES).toEqual([
      'profile_activity',
      'digital_footprint',
      'actions_on_behalf',
    ]);
    expect(isCandidateCapability('profile_activity')).toBe(true);
    expect(isCandidateCapability('digital_footprint')).toBe(true);
    expect(isCandidateCapability('actions_on_behalf')).toBe(true);
    expect(isCandidateCapability('unknown_cap')).toBe(false);
  });

  it('contains 3-5 clean candidate-facing items per capability with zero forbidden terms', () => {
    const forbidden = [/osint/iu, /биометри/iu, /robin/iu, /eye_of_web/iu];

    for (const cap of CANDIDATE_CAPABILITIES) {
      const doc = CAPABILITY_CONSENT_DOCUMENTS[cap];
      expect(doc.items.length).toBeGreaterThanOrEqual(3);
      expect(doc.items.length).toBeLessThanOrEqual(5);

      const allText = `${doc.title} ${doc.items.join(' ')}`;
      for (const pattern of forbidden) {
        expect(allText).not.toMatch(pattern);
      }
    }
  });
});

describe('SqliteCapabilityConsentStore', () => {
  function createStore() {
    const db = new DatabaseSync(':memory:');
    const store = new SqliteCapabilityConsentStore(db);
    return { db, store };
  }

  it('records consent and returns active record', () => {
    const { store } = createStore();
    const consent = store.recordConsent({
      userId: 'usr-1',
      capability: 'profile_activity',
      versionId: 'profile_activity-v1.0',
      grantedAt: '2026-09-29T10:00:00.000Z',
    });

    expect(consent.id).toBeDefined();
    expect(consent.userId).toBe('usr-1');
    expect(consent.capability).toBe('profile_activity');
    expect(consent.versionId).toBe('profile_activity-v1.0');
    expect(consent.grantedAt).toBe('2026-09-29T10:00:00.000Z');
    expect(consent.revokedAt).toBeNull();

    const active = store.getActiveConsent('usr-1', 'profile_activity');
    expect(active).toEqual(consent);
  });

  it('is idempotent when re-recording identical version', () => {
    const { store } = createStore();
    const first = store.recordConsent({
      userId: 'usr-1',
      capability: 'digital_footprint',
      versionId: 'digital_footprint-v1.0',
    });
    const second = store.recordConsent({
      userId: 'usr-1',
      capability: 'digital_footprint',
      versionId: 'digital_footprint-v1.0',
    });

    expect(second.id).toBe(first.id);
    expect(store.listConsents('usr-1', 'digital_footprint')).toHaveLength(1);
  });

  it('revokes previous version when upgrading to a new version', () => {
    const { store } = createStore();
    const v1 = store.recordConsent({
      userId: 'usr-1',
      capability: 'actions_on_behalf',
      versionId: 'actions_on_behalf-v1.0',
      grantedAt: '2026-09-01T10:00:00.000Z',
    });

    const v2 = store.recordConsent({
      userId: 'usr-1',
      capability: 'actions_on_behalf',
      versionId: 'actions_on_behalf-v2.0',
      grantedAt: '2026-09-15T10:00:00.000Z',
    });

    expect(v2.id).not.toBe(v1.id);
    expect(v2.versionId).toBe('actions_on_behalf-v2.0');
    expect(v2.revokedAt).toBeNull();

    const active = store.getActiveConsent('usr-1', 'actions_on_behalf');
    expect(active?.id).toBe(v2.id);

    const history = store.listConsents('usr-1', 'actions_on_behalf');
    expect(history).toHaveLength(2);
    expect(history[0].revokedAt).toBe('2026-09-15T10:00:00.000Z');
  });

  it('revokes active consent and supports re-granting later', () => {
    const { store } = createStore();
    store.recordConsent({
      userId: 'usr-1',
      capability: 'profile_activity',
      versionId: 'profile_activity-v1.0',
      grantedAt: '2026-09-01T10:00:00.000Z',
    });

    const revoked = store.revokeConsent(
      'usr-1',
      'profile_activity',
      '2026-09-05T12:00:00.000Z',
    );
    expect(revoked).not.toBeNull();
    expect(revoked?.revokedAt).toBe('2026-09-05T12:00:00.000Z');

    expect(store.getActiveConsent('usr-1', 'profile_activity')).toBeNull();

    // Revoking again when already inactive returns null
    expect(store.revokeConsent('usr-1', 'profile_activity')).toBeNull();

    // Re-granting creates new active consent
    const regranted = store.recordConsent({
      userId: 'usr-1',
      capability: 'profile_activity',
      versionId: 'profile_activity-v1.0',
      grantedAt: '2026-09-10T10:00:00.000Z',
    });
    expect(regranted.revokedAt).toBeNull();
    expect(store.getActiveConsent('usr-1', 'profile_activity')?.id).toBe(regranted.id);
  });

  it('deletes all capability consents when user account is wiped', () => {
    const { store } = createStore();
    store.recordConsent({
      userId: 'usr-alice',
      capability: 'profile_activity',
      versionId: 'profile_activity-v1.0',
    });
    store.recordConsent({
      userId: 'usr-alice',
      capability: 'digital_footprint',
      versionId: 'digital_footprint-v1.0',
    });
    store.recordConsent({
      userId: 'usr-bob',
      capability: 'profile_activity',
      versionId: 'profile_activity-v1.0',
    });

    const deleted = store.deleteForUser('usr-alice');
    expect(deleted).toBe(2);

    expect(store.listConsents('usr-alice')).toHaveLength(0);
    expect(store.listConsents('usr-bob')).toHaveLength(1);
  });

  it('purges only expired revoked consents and keeps active ones', () => {
    const { db, store } = createStore();
    // 1. Revoked consent before cutoff -> should be purged
    store.recordConsent({
      userId: 'usr-old',

      capability: 'profile_activity',
      versionId: 'profile_activity-v1.0',
      grantedAt: '2020-01-01T00:00:00.000Z',
    });
    store.revokeConsent('usr-old', 'profile_activity', '2021-01-01T00:00:00.000Z');

    // 2. Active consent granted long ago -> should NOT be purged
    store.recordConsent({
      userId: 'usr-active-old',
      capability: 'digital_footprint',
      versionId: 'digital_footprint-v1.0',
      grantedAt: '2020-01-01T00:00:00.000Z',
    });

    // 3. Recently revoked consent -> should NOT be purged
    store.recordConsent({
      userId: 'usr-recent',
      capability: 'actions_on_behalf',
      versionId: 'actions_on_behalf-v1.0',
      grantedAt: '2026-09-01T00:00:00.000Z',
    });
    store.revokeConsent('usr-recent', 'actions_on_behalf', '2026-09-10T00:00:00.000Z');

    const purged = purgeExpiredCapabilityConsents(db, '2023-01-01T00:00:00.000Z');
    expect(purged).toBe(1);

    expect(store.listConsents('usr-old')).toHaveLength(0);
    expect(store.listConsents('usr-active-old')).toHaveLength(1);
    expect(store.listConsents('usr-recent')).toHaveLength(1);
  });
});
