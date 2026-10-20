import { SqliteRelocationScenarioRepository } from './sqliteRelocationScenarioRepository';
import type { DatabaseSync } from 'node:sqlite';
import { RELOCATION_CONSENT_VERSION, emptyRelocationQuestionnaire, relocationQuestionnaireSchema, relocationQuestionnaireStepSchemas, relocationProgressSchema, type RelocationConsentState, type RelocationCurrentStep, type RelocationQuestionnaire, type RelocationQuestionnaireStepData, type RelocationStepId } from '../../shared/relocationQuestionnaire';
import type { SealedText } from './sealedText';
import { RELOCATION_QUESTIONNAIRE_SCHEMA } from './relocationQuestionnaireSchema';
import { runSqliteTransaction } from './sqliteTransaction';

interface ConsentRow {
  readonly version_id: string;
  readonly granted_at: string;
  readonly revoked_at: string | null;
}

interface ProfileRow {
  readonly profile_cipher: string;
  readonly revision: number;
}

export class RelocationConsentRequiredError extends Error {
  constructor() {
    super('relocation questionnaire requires active consent');
    this.name = 'RelocationConsentRequiredError';
  }
}

export class RelocationProfileRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('relocation questionnaire revision changed');
    this.name = 'RelocationProfileRevisionConflictError';
  }
}

export class RelocationQuestionnaireStorageError extends Error {
  constructor() {
    super('relocation questionnaire data could not be read');
    this.name = 'RelocationQuestionnaireStorageError';
  }
}

export class SqliteRelocationQuestionnaireRepository {
  readonly scenarios: SqliteRelocationScenarioRepository;
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(RELOCATION_QUESTIONNAIRE_SCHEMA);
    this.scenarios = new SqliteRelocationScenarioRepository(database, sealedText);
  }

  getConsent(candidateId: string): RelocationConsentState {
    const row = this.latestConsentRow(candidateId);
    if (!row) return { status: 'not_granted', granted: false, versionId: null, grantedAt: null, revokedAt: null };
    const granted = row.revoked_at === null;
    return {
      status: granted ? 'granted' : 'revoked',
      granted,
      versionId: row.version_id,
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at,
    };
  }

  grantConsent(candidateId: string, versionId: string, now: string): RelocationConsentState {
    if (versionId !== RELOCATION_CONSENT_VERSION) throw new Error('relocation consent version is invalid');
    return runSqliteTransaction(this.database, () => this.recordConsent(candidateId, versionId, now));
  }

  revokeConsent(candidateId: string, now: string): RelocationConsentState {
    const consent = runSqliteTransaction(this.database, () => {
      const active = this.database.prepare(
        'SELECT version_id, granted_at, revoked_at FROM relocation_questionnaire_consents WHERE candidate_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',
      ).get(candidateId) as ConsentRow | undefined;
      if (active) {
        this.database.prepare('UPDATE relocation_questionnaire_consents SET revoked_at = ? WHERE candidate_id = ? AND revoked_at IS NULL').run(now, candidateId);
      }
      this.deleteProfileRow(candidateId);
      this.scenarios.deleteAll(candidateId);
      return this.getConsent(candidateId);
    });
    this.checkpointAfterDeletion();
    return consent;
  }

  getProfile(candidateId: string): RelocationQuestionnaire | null {
    if (!this.getConsent(candidateId).granted) return null;
    const row = this.profileRow(candidateId);
    if (!row) return null;
    return this.openProfile(candidateId, row.profile_cipher);
  }

  putStep<K extends RelocationStepId>(
    candidateId: string,
    step: K,
    data: RelocationQuestionnaireStepData[K],
    expectedRevision: number,
    now: string,
  ): RelocationQuestionnaire {
    return runSqliteTransaction(this.database, () => this.writeStep(candidateId, step, data, expectedRevision, now));
  }

  putProgress(candidateId: string, data: unknown, expectedRevision: number, now: string): RelocationQuestionnaire {
    const progress = relocationProgressSchema.parse(data);
    return runSqliteTransaction(this.database, () => {
      const profile = this.profileForWrite(candidateId, expectedRevision);
      const updated = relocationQuestionnaireSchema.parse({ ...profile, ...progress, revision: profile.revision + 1, updatedAt: now });
      this.persistProfile(candidateId, updated, now);
      return updated;
    });
  }

  deleteProfile(candidateId: string, expectedRevision?: number): boolean {
    const deleted = runSqliteTransaction(this.database, () => {
      const row = this.profileRow(candidateId);
      if (!row) return false;
      const currentRevision = row.revision;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new RelocationProfileRevisionConflictError(currentRevision);
      }
      this.scenarios.deleteAll(candidateId);
      return this.deleteProfileRow(candidateId);
    });
    if (deleted) this.checkpointAfterDeletion();
    return deleted;
  }

  private recordConsent(candidateId: string, versionId: string, now: string): RelocationConsentState {
    const current = this.getConsent(candidateId);
    if (current.granted && current.versionId === versionId) return current;
    if (current.granted) {
      this.database.prepare('UPDATE relocation_questionnaire_consents SET revoked_at = ? WHERE candidate_id = ? AND revoked_at IS NULL').run(now, candidateId);
    }
    this.database.prepare(
      'INSERT INTO relocation_questionnaire_consents (candidate_id, version_id, granted_at, revoked_at) VALUES (?, ?, ?, NULL)',
    ).run(candidateId, versionId, now);
    return this.getConsent(candidateId);
  }

  private writeStep<K extends RelocationStepId>(
    candidateId: string,
    step: K,
    data: RelocationQuestionnaireStepData[K],
    expectedRevision: number,
    now: string,
  ): RelocationQuestionnaire {
    const parsed = relocationQuestionnaireStepSchemas[step].parse(data);
    const profile = this.profileForWrite(candidateId, expectedRevision);
    const updated = replaceStep(profile, step, parsed, profile.currentStep, now);
    this.persistProfile(candidateId, updated, now);
    return updated;
  }

  private profileForWrite(candidateId: string, expectedRevision: number): RelocationQuestionnaire {
    if (!this.getConsent(candidateId).granted) throw new RelocationConsentRequiredError();
    const row = this.profileRow(candidateId);
    const currentRevision = row?.revision ?? 0;
    if (currentRevision !== expectedRevision) throw new RelocationProfileRevisionConflictError(currentRevision);
    return row ? this.openProfile(candidateId, row.profile_cipher) : emptyRelocationQuestionnaire();
  }

  private persistProfile(candidateId: string, profile: RelocationQuestionnaire, now: string): void {
    this.database.prepare(
      `INSERT INTO relocation_questionnaire_profiles (candidate_id, profile_cipher, revision, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET
         profile_cipher = excluded.profile_cipher,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
    ).run(candidateId, this.sealedText.seal(JSON.stringify(profile), associatedData(candidateId)), profile.revision, now);
  }

  private openProfile(candidateId: string, cipher: string): RelocationQuestionnaire {
    try {
      const parsed = relocationQuestionnaireSchema.safeParse(JSON.parse(this.sealedText.open(cipher, associatedData(candidateId))));
      if (!parsed.success) throw new RelocationQuestionnaireStorageError();
      return parsed.data;
    } catch {
      throw new RelocationQuestionnaireStorageError();
    }
  }

  private profileRow(candidateId: string): ProfileRow | undefined {
    return this.database.prepare(
      'SELECT profile_cipher, revision FROM relocation_questionnaire_profiles WHERE candidate_id = ?',
    ).get(candidateId) as ProfileRow | undefined;
  }

  private latestConsentRow(candidateId: string): ConsentRow | undefined {
    return this.database.prepare(
      'SELECT version_id, granted_at, revoked_at FROM relocation_questionnaire_consents WHERE candidate_id = ? ORDER BY id DESC LIMIT 1',
    ).get(candidateId) as ConsentRow | undefined;
  }

  private deleteProfileRow(candidateId: string): boolean {
    return Number(this.database.prepare(
      'DELETE FROM relocation_questionnaire_profiles WHERE candidate_id = ?',
    ).run(candidateId).changes) > 0;
  }

  private checkpointAfterDeletion(): void {
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
}

function replaceStep(
  profile: RelocationQuestionnaire,
  step: RelocationStepId,
  data: unknown,
  currentStep: RelocationCurrentStep,
  now: string,
): RelocationQuestionnaire {
  const updated = { ...profile, revision: profile.revision + 1, currentStep, updatedAt: now };
  if (step === 'citizenship_documents') {
    return relocationQuestionnaireSchema.parse({ ...updated, citizenshipDocuments: relocationQuestionnaireStepSchemas.citizenship_documents.parse(data) });
  }
  if (step === 'education') {
    return relocationQuestionnaireSchema.parse({ ...updated, education: relocationQuestionnaireStepSchemas.education.parse(data) });
  }
  if (step === 'family') {
    return relocationQuestionnaireSchema.parse({ ...updated, family: relocationQuestionnaireStepSchemas.family.parse(data) });
  }
  return relocationQuestionnaireSchema.parse({ ...updated, languages: relocationQuestionnaireStepSchemas.languages.parse(data) });
}

function associatedData(candidateId: string): string {
  return `candidate:${candidateId}:relocation-questionnaire`;
}
