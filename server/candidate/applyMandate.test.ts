import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CONSENT_CURRENT_VERSION,
  CAPABILITY_CONSENT_DOCUMENTS,
  capabilityConsentDocument,
} from '../../src/features/legal/capabilityConsents';
import { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';
import { hasActionsConsent, hasApplyMandate } from './applyMandate';

const V1 = 'actions_on_behalf-v1.0';
const V11 = 'actions_on_behalf-v1.1';

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    "CREATE TABLE users (id TEXT PRIMARY KEY, candidate_id TEXT); INSERT INTO users VALUES ('usr-1', 'cand-1'), ('usr-2', 'cand-2')",
  );
  return new SqliteCapabilityConsentStore(database);
}

describe('B787: поручение на отклик', () => {
  it('текст v1.1 — дословно одобренный владельцем, v1.0 остаётся в истории', () => {
    expect(CAPABILITY_CONSENT_CURRENT_VERSION.actions_on_behalf).toBe(V11);
    expect(CAPABILITY_CONSENT_DOCUMENTS.actions_on_behalf.items).toEqual([
      'Поручаю OpenQareer по моей команде направлять отклик выбранному работодателю и от моего имени подтверждать согласие на обработку моих данных для рассмотрения этого отклика на hh, LinkedIn и сайте работодателя; текст сохраняется и доступен мне.',
    ]);
    expect(capabilityConsentDocument('actions_on_behalf', V1).versionId).toBe(V1);
    expect(capabilityConsentDocument('actions_on_behalf', V1).items).toHaveLength(4);
    expect(capabilityConsentDocument('actions_on_behalf', V11)).toBe(
      CAPABILITY_CONSENT_DOCUMENTS.actions_on_behalf,
    );
  });

  it('принято только v1.1: ни v1.0, ни отозванное, ни чужое, ни отсутствие хранилища', () => {
    const store = setup();
    const grant = (versionId: string, userId = 'usr-1') =>
      store.recordConsent({ userId, capability: 'actions_on_behalf', versionId });
    expect(hasApplyMandate(store, 'cand-1')).toBe(false);
    grant(V1);
    expect(hasApplyMandate(store, 'cand-1')).toBe(false);
    grant(V11);
    expect(hasApplyMandate(store, 'cand-1')).toBe(true);
    expect(hasApplyMandate(store, 'cand-2')).toBe(false);
    expect(store.listConsents('usr-1').map((item) => item.versionId)).toEqual([V1, V11]);
    store.revokeConsent('usr-1', 'actions_on_behalf');
    expect(hasApplyMandate(store, 'cand-1')).toBe(false);
    expect(hasApplyMandate(undefined, 'cand-1')).toBe(false);
  });

  it('подъём резюме остаётся у принявших v1.0; отклик в том же пакете требует v1.1', () => {
    const store = setup();
    const boost = { actionKind: 'hh_resume_boost' };
    expect(hasActionsConsent(store, 'cand-1', [boost])).toBe(false);
    store.recordConsent({ userId: 'usr-1', capability: 'actions_on_behalf', versionId: V1 });
    expect(hasActionsConsent(store, 'cand-1', [boost])).toBe(true);
    expect(hasActionsConsent(store, 'cand-1', [boost, { actionKind: 'hh_apply' }])).toBe(false);
    expect(hasActionsConsent(store, 'cand-1', [])).toBe(false);
  });
});
