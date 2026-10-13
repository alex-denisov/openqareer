import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RELOCATION_CONSENT_VERSION,
  emptyRelocationQuestionnaire,
} from '../../shared/relocationQuestionnaire';
import { SealedText } from './sealedText';
import {
  RelocationProfileRevisionConflictError,
  SqliteRelocationQuestionnaireRepository,
} from './sqliteRelocationQuestionnaireRepository';

const resources: Array<{ database: DatabaseSync; repository: SqliteRelocationQuestionnaireRepository }> = [];

function setup() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES (\'candidate-a\'), (\'candidate-b\');');
  const repository = new SqliteRelocationQuestionnaireRepository(database, new SealedText(randomBytes(32)));
  resources.push({ database, repository });
  return { database, repository };
}

afterEach(() => {
  for (const resource of resources.splice(0)) resource.database.close();
});

describe('SqliteRelocationQuestionnaireRepository', () => {
  it('encrypts private questionnaire fields and isolates candidates', () => {
    const { database, repository } = setup();
    repository.grantConsent('candidate-a', RELOCATION_CONSENT_VERSION, '2026-10-11T10:00:00.000Z');
    const profile = repository.putStep(
      'candidate-a',
      'languages',
      { languages: [{ id: 'language-1', name: 'English', level: 'C1', source: 'candidate', confirmation: 'confirmed' }] },
      0,
      '2026-10-11T10:01:00.000Z',
    );
    const row = database.prepare('SELECT profile_cipher FROM relocation_questionnaire_profiles WHERE candidate_id = ?').get('candidate-a') as { profile_cipher: string };

    expect(profile.languages.languages[0]?.name).toBe('English');
    expect(row.profile_cipher).not.toContain('English');
    expect(repository.getProfile('candidate-b')).toBeNull();
    expect(repository.getProfile('candidate-a')?.revision).toBe(1);
  });

  it('rejects stale writes instead of replacing a newer step revision', () => {
    const { repository } = setup();
    repository.grantConsent('candidate-a', RELOCATION_CONSENT_VERSION, '2026-10-11T10:00:00.000Z');
    repository.putStep('candidate-a', 'family', {
      partnerStatus: 'no_partner', relocationTimeframe: 'unknown', familyMovePlan: 'not_applicable',
    }, 0, '2026-10-11T10:01:00.000Z');

    expect(() => repository.putStep('candidate-a', 'family', {
      partnerStatus: 'has_partner', relocationTimeframe: 'unknown', familyMovePlan: 'later',
    }, 0, '2026-10-11T10:02:00.000Z')).toThrow(RelocationProfileRevisionConflictError);
    expect(repository.getProfile('candidate-a')?.family.partnerStatus).toBe('no_partner');
  });

  it('revoke records the decision and deletes encrypted questionnaire data atomically', () => {
    const { database, repository } = setup();
    repository.grantConsent('candidate-a', RELOCATION_CONSENT_VERSION, '2026-10-11T10:00:00.000Z');
    repository.putStep('candidate-a', 'citizenship_documents', {
      citizenshipCountryCodes: ['RU'], documents: [],
    }, 0, '2026-10-11T10:01:00.000Z');

    const revoked = repository.revokeConsent('candidate-a', '2026-10-11T10:02:00.000Z');
    const counts = database.prepare(`
      SELECT (SELECT COUNT(*) FROM relocation_questionnaire_profiles WHERE candidate_id = ?) AS profiles,
             (SELECT COUNT(*) FROM relocation_questionnaire_consents WHERE candidate_id = ? AND revoked_at IS NOT NULL) AS revoked
    `).get('candidate-a', 'candidate-a') as { profiles: number; revoked: number };

    expect(revoked?.revokedAt).toBe('2026-10-11T10:02:00.000Z');
    expect(counts).toEqual({ profiles: 0, revoked: 1 });
    expect(repository.getProfile('candidate-a')).toBeNull();
    expect(repository.getConsent('candidate-a').granted).toBe(false);
  });

  it('restart clears step data but preserves the active consent', () => {
    const { repository } = setup();
    repository.grantConsent('candidate-a', RELOCATION_CONSENT_VERSION, '2026-10-11T10:00:00.000Z');
    repository.putStep('candidate-a', 'citizenship_documents', {
      citizenshipCountryCodes: ['RU'], documents: [],
    }, 0, '2026-10-11T10:01:00.000Z');

    expect(repository.deleteProfile('candidate-a')).toBe(true);
    expect(repository.getConsent('candidate-a').granted).toBe(true);
    expect(repository.getProfile('candidate-a')).toBeNull();
    expect(emptyRelocationQuestionnaire().revision).toBe(0);
  });

  it('creates its schema idempotently on repeated startup', () => {
    const { database } = setup();
    expect(() => new SqliteRelocationQuestionnaireRepository(database, new SealedText(randomBytes(32)))).not.toThrow();
  });

  it('cascades questionnaire and consent history when the candidate is deleted', () => {
    const { database, repository } = setup();
    repository.grantConsent('candidate-a', RELOCATION_CONSENT_VERSION, '2026-10-11T10:00:00.000Z');
    repository.putStep('candidate-a', 'citizenship_documents', { citizenshipCountryCodes: ['RU'], documents: [] }, 0, '2026-10-11T10:01:00.000Z');
    database.prepare('DELETE FROM candidates WHERE id = ?').run('candidate-a');
    const counts = database.prepare(`
      SELECT (SELECT COUNT(*) FROM relocation_questionnaire_profiles WHERE candidate_id = ?) AS profiles,
             (SELECT COUNT(*) FROM relocation_questionnaire_consents WHERE candidate_id = ?) AS consents
    `).get('candidate-a', 'candidate-a') as { profiles: number; consents: number };

    expect(counts).toEqual({ profiles: 0, consents: 0 });
  });

  it('does not duplicate an active consent and keeps revocation history on regrant', () => {
    const { database, repository } = setup();
    const first = repository.grantConsent('candidate-a', RELOCATION_CONSENT_VERSION, '2026-10-11T10:00:00.000Z');
    expect(repository.grantConsent('candidate-a', RELOCATION_CONSENT_VERSION, '2026-10-11T10:01:00.000Z')).toEqual(first);
    repository.revokeConsent('candidate-a', '2026-10-11T10:02:00.000Z');
    repository.grantConsent('candidate-a', RELOCATION_CONSENT_VERSION, '2026-10-11T10:03:00.000Z');
    const count = database.prepare('SELECT COUNT(*) AS count FROM relocation_questionnaire_consents WHERE candidate_id = ?').get('candidate-a') as { count: number };

    expect(count.count).toBe(2);
    expect(repository.getConsent('candidate-a')).toMatchObject({ granted: true, status: 'granted' });
  });
});
