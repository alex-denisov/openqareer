import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';
import {
  canLegacyClientAdvanceToApplied,
  type ApplicationStage,
  type DeliveryReceipt,
} from '../../shared/applicationStage';
import {
  ApplicationNotFoundError,
  ApplicationVersionConflictError,
} from './store/errors';
import type { VacancyApplicationSnapshot } from '../../shared/vacancyApplication';
import { DEFAULT_APPLICATION_ARCHIVE_STALE_DAYS, type ApplicationArchiveReason } from '../../shared/applicationArchive';

export type ApplicationProcessProfile = 'standard' | 'executive';
export type ApplicationEventProvenance = 'candidate' | 'migrated' | 'legacy_client' | 'system';
export type ApplicationEventKind =
  | 'stage'
  | 'note'
  | 'follow_up_sent'
  | 'thank_you_sent'
  | 'promise'
  | 'material';

export interface StoredApplicationEvent {
  readonly id: string;
  readonly kind: ApplicationEventKind;
  readonly fromStage: ApplicationStage | null;
  readonly toStage: ApplicationStage | null;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly provenance: ApplicationEventProvenance;
  readonly deliveryReceipt?: DeliveryReceipt | null;
}

export interface ConfirmedVacancyClosureEvidence {
  readonly kind: 'archived_marker' | 'confirmed_gone_response';
  readonly sourceId: string;
  readonly vacancyUrl: string;
  readonly observedAt: string;
}

export interface StoredApplication {
  readonly id: string;
  readonly candidateId: string;
  readonly clusterId: string | null;
  readonly stage: ApplicationStage;
  readonly closedReason: string | null;
  readonly archiveReason: ApplicationArchiveReason | null;
  readonly archivePreviousStage: ApplicationStage | null;
  readonly processProfile: ApplicationProcessProfile;
  readonly vacancy: VacancyApplicationSnapshot | null;
  readonly notes: string | null;
  readonly followUpDueAt: string | null;
  readonly stageChangedAt: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateApplicationInput {
  readonly clusterId?: string | null;
  readonly vacancy?: VacancyApplicationSnapshot;
  readonly stage: ApplicationStage;
  readonly occurredAt?: string;
  /** Defaults to `standard` (server/vacancies/processProfileDefault.ts decides). */
  readonly processProfile?: ApplicationProcessProfile;
}

export interface PatchApplicationInput {
  readonly expectedVersion: number;
  readonly stage?: ApplicationStage;
  readonly occurredAt?: string;
  readonly notes?: string | null;
  readonly processProfile?: ApplicationProcessProfile;
  readonly followUpDueAt?: string | null;
  readonly deliveryReceipt?: DeliveryReceipt | null;
}

interface ApplicationRow {
  id: string;
  candidate_id: string;
  cluster_id: string | null;
  stage: string;
  closed_reason: string | null;
  archive_reason: ApplicationArchiveReason | null;
  archive_previous_stage: ApplicationStage | null;
  process_profile: string;
  vacancy_cipher: string | null;
  notes_cipher: string | null;
  follow_up_due_at: string | null;
  stage_changed_at: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Отклики трекера (B251, S1, architecture.md §3, вариант B).
 *
 * `vacancy_applications` (MIGRATION_28) остаётся нетронутым фасадом для
 * старого `.app`: этот репозиторий читает и пишет только новые таблицы.
 * Свободный текст (снимок вакансии, заметки) — через `sealedText`, этапы и
 * даты — открыто, чтобы воронка считалась SQL-запросом.
 */
export class SqliteApplicationRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  list(candidateId: string): StoredApplication[] {
    const rows = this.database
      .prepare(
        `SELECT id, candidate_id, cluster_id, stage, closed_reason, archive_reason, archive_previous_stage, process_profile,
                vacancy_cipher, notes_cipher, follow_up_due_at, stage_changed_at,
                version, created_at, updated_at
           FROM applications
          WHERE candidate_id = ?
          ORDER BY updated_at DESC`,
      )
      .all(candidateId) as unknown as ApplicationRow[];
    return rows.map((row) => this.toApplication(row));
  }

  get(candidateId: string, id: string): StoredApplication | null {
    const row = this.database
      .prepare(
        `SELECT id, candidate_id, cluster_id, stage, closed_reason, archive_reason, archive_previous_stage, process_profile,
                vacancy_cipher, notes_cipher, follow_up_due_at, stage_changed_at,
                version, created_at, updated_at
           FROM applications
          WHERE candidate_id = ? AND id = ?`,
      )
      .get(candidateId, id) as ApplicationRow | undefined;
    return row ? this.toApplication(row) : null;
  }

  private findByCluster(candidateId: string, clusterId: string): StoredApplication | null {
    const row = this.database
      .prepare(
        `SELECT id, candidate_id, cluster_id, stage, closed_reason, archive_reason, archive_previous_stage, process_profile,
                vacancy_cipher, notes_cipher, follow_up_due_at, stage_changed_at,
                version, created_at, updated_at
           FROM applications
          WHERE candidate_id = ? AND cluster_id = ?`,
      )
      .get(candidateId, clusterId) as ApplicationRow | undefined;
    return row ? this.toApplication(row) : null;
  }

  /**
   * Повторный вызов с тем же `clusterId` не создаёт дубль (architecture.md
   * §4): существующая карточка возвращается как есть.
   */
  create(
    candidateId: string,
    input: CreateApplicationInput,
    now = new Date().toISOString(),
  ): StoredApplication {
    if (input.clusterId) {
      const existing = this.findByCluster(candidateId, input.clusterId);
      if (existing) return existing;
    }
    const id = randomUUID();
    const occurredAt = input.occurredAt ?? now;
    this.database
      .prepare(
        `INSERT INTO applications
          (id, candidate_id, cluster_id, stage, process_profile, vacancy_cipher,
           archive_reason, archive_previous_stage,
           follow_up_due_at, stage_changed_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?)`,
      )
      .run(
        id,
        candidateId,
        input.clusterId ?? null,
        input.stage,
        input.processProfile ?? 'standard',
        input.vacancy
          ? this.sealedText.seal(JSON.stringify(input.vacancy), vacancyAssociatedData(candidateId, id))
          : null,
        input.stage === 'archived' ? 'candidate' : null,
        occurredAt,
        now,
        now,
      );
    this.insertEvent(candidateId, id, {
      kind: 'stage',
      fromStage: null,
      toStage: input.stage,
      occurredAt,
      provenance: 'candidate',
    }, now);
    return this.get(candidateId, id) as StoredApplication;
  }

  /** 409 — `expectedVersion` устарел, карточка открыта на двух устройствах. */
  patch(
    candidateId: string,
    id: string,
    input: PatchApplicationInput,
    now = new Date().toISOString(),
  ): StoredApplication {
    const current = this.get(candidateId, id);
    if (!current) throw new ApplicationNotFoundError();
    if (current.version !== input.expectedVersion) {
      throw new ApplicationVersionConflictError(current.version);
    }
    const nextStage = input.stage ?? current.stage;
    const stageChanged = nextStage !== current.stage;
    const occurredAt = input.occurredAt ?? now;
    const nextNotes = input.notes !== undefined ? input.notes : current.notes;
    const nextNotesCipher =
      nextNotes === null ? null : this.sealedText.seal(nextNotes, notesAssociatedData(candidateId, id));
    return this.transaction(() =>
      this.persistPatch(
        candidateId,
        id,
        input,
        current,
        nextStage,
        stageChanged,
        occurredAt,
        now,
        nextNotesCipher,
        stageChanged ? (nextStage === 'archived' ? 'candidate' : null) : undefined,
        stageChanged && nextStage === 'archived' ? current.stage : stageChanged ? null : undefined,
      ),
    );
  }

  /**
   * Дубль старого `POST /vacancy-applications` (architecture.md §4): создаёт
   * или поднимает карточку до `applied`, но никогда не понижает этап уже
   * продвинувшейся карточки.
   */
  recordLegacyApplied(
    candidateId: string,
    clusterId: string,
    vacancy: VacancyApplicationSnapshot,
    now = new Date().toISOString(),
  ): void {
    const existing = this.findByCluster(candidateId, clusterId);
    if (!existing) {
      const id = randomUUID();
      this.database
        .prepare(
          `INSERT INTO applications
            (id, candidate_id, cluster_id, stage, process_profile, vacancy_cipher,
             stage_changed_at, version, created_at, updated_at)
           VALUES (?, ?, ?, 'applied', 'standard', ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          candidateId,
          clusterId,
          this.sealedText.seal(JSON.stringify(vacancy), vacancyAssociatedData(candidateId, id)),
          now,
          now,
          now,
        );
      this.insertEvent(candidateId, id, {
        kind: 'stage',
        fromStage: null,
        toStage: 'applied',
        occurredAt: now,
        provenance: 'legacy_client',
      }, now);
      return;
    }
    if (!canLegacyClientAdvanceToApplied(existing.stage)) return;
    if (existing.stage === 'applied') return;
    this.database
      .prepare(
        `UPDATE applications SET stage = 'applied', stage_changed_at = ?, version = version + 1, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(now, now, candidateId, existing.id);
    this.insertEvent(candidateId, existing.id, {
      kind: 'stage',
      fromStage: existing.stage,
      toStage: 'applied',
      occurredAt: now,
      provenance: 'legacy_client',
    }, now);
  }

  /**
   * Ленивый перенос старых `applied` (architecture.md §5). Идемпотентен:
   * повторный вызов ничего не дублирует, потому что каждый `clusterId`
   * проверяется через `findByCluster` перед вставкой. `opened` не переносится.
   */
  migrateLegacyApplied(
    candidateId: string,
    legacyApplied: readonly {
      clusterId: string;
      vacancy: VacancyApplicationSnapshot;
      appliedAt: string | null;
    }[],
    now = new Date().toISOString(),
  ): void {
    for (const legacy of legacyApplied) {
      if (this.findByCluster(candidateId, legacy.clusterId)) continue;
      const id = randomUUID();
      const appliedAt = legacy.appliedAt ?? now;
      this.database
        .prepare(
          `INSERT INTO applications
            (id, candidate_id, cluster_id, stage, process_profile, vacancy_cipher,
             stage_changed_at, version, created_at, updated_at)
           VALUES (?, ?, ?, 'applied', 'standard', ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          candidateId,
          legacy.clusterId,
          this.sealedText.seal(JSON.stringify(legacy.vacancy), vacancyAssociatedData(candidateId, id)),
          appliedAt,
          now,
          now,
        );
      this.insertEvent(candidateId, id, {
        kind: 'stage',
        fromStage: null,
        toStage: 'applied',
        occurredAt: appliedAt,
        provenance: 'migrated',
      }, now);
    }
  }

  /**
   * `POST /applications/:id/events` (architecture.md §4): follow-up sent,
   * thank-you sent, or a promise the company made. Does not touch `stage`.
   */
  recordEvent(
    candidateId: string,
    applicationId: string,
    input: { kind: 'follow_up_sent' | 'thank_you_sent' | 'promise'; occurredAt: string; note?: string | null },
    now = new Date().toISOString(),
  ): StoredApplication {
    const current = this.get(candidateId, applicationId);
    if (!current) throw new ApplicationNotFoundError();
    this.insertEvent(
      candidateId,
      applicationId,
      { kind: input.kind, fromStage: null, toStage: null, occurredAt: input.occurredAt, provenance: 'candidate' },
      now,
      input.note ? this.sealedText.seal(input.note, eventAssociatedData(candidateId, applicationId)) : null,
    );
    return current;
  }

  /** Только подтверждённый ответ площадки может записать причину `vacancy_closed`. */
  archiveClosedVacancy(
    candidateId: string,
    application: StoredApplication,
    evidence: ConfirmedVacancyClosureEvidence,
    now = new Date().toISOString(),
  ): StoredApplication {
    return this.transaction(() => {
      const current = this.get(candidateId, application.id);
      if (!current) throw new ApplicationNotFoundError();
      if (current.stage === 'archived' || current.stage === 'rejected') return current;
      if (current.version !== application.version) {
        throw new ApplicationVersionConflictError(current.version);
      }
      assertClosureEvidence(current, evidence);
      const result = this.database
        .prepare(
          `UPDATE applications SET stage = 'archived', closed_reason = 'vacancy_closed',
             archive_reason = 'vacancy_closed', archive_previous_stage = ?,
             stage_changed_at = ?, version = version + 1, updated_at = ?
           WHERE candidate_id = ? AND id = ? AND version = ? AND stage = ?`,
        )
        .run(current.stage, now, now, candidateId, current.id, current.version, current.stage);
      if (result.changes !== 1) {
        const latest = this.get(candidateId, current.id);
        if (!latest) throw new ApplicationNotFoundError();
        throw new ApplicationVersionConflictError(latest.version);
      }
      this.insertEvent(
        candidateId,
        current.id,
        { kind: 'stage', fromStage: current.stage, toStage: 'archived', occurredAt: now, provenance: 'system' },
        now,
        this.sealedText.seal(
          JSON.stringify({ closureEvidence: evidence }),
          eventAssociatedData(candidateId, current.id),
        ),
      );
      return this.get(candidateId, current.id) as StoredApplication;
    });
  }

  /** Переносит отклик в архив по системному сроку бездействия, если политика включена. */
  archiveStale(
    candidateId: string,
    applicationId: string,
    now: string,
    staleDays: number = DEFAULT_APPLICATION_ARCHIVE_STALE_DAYS,
  ): StoredApplication {
    const current = this.get(candidateId, applicationId);
    if (!current) throw new ApplicationNotFoundError();
    if (current.stage === 'archived' || current.stage === 'rejected') return current;
    const inactivity = Date.parse(now) - Date.parse(current.stageChangedAt);
    if (inactivity < staleDays * 24 * 60 * 60 * 1_000) return current;
    return this.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE applications SET stage = 'archived', archive_reason = 'stale',
             archive_previous_stage = ?, stage_changed_at = ?, version = version + 1, updated_at = ?
           WHERE candidate_id = ? AND id = ? AND version = ? AND stage <> 'archived'`,
        )
        .run(current.stage, now, now, candidateId, applicationId, current.version);
      if (result.changes !== 1) {
        const latest = this.get(candidateId, applicationId);
        if (!latest) throw new ApplicationNotFoundError();
        throw new ApplicationVersionConflictError(latest.version);
      }
      this.insertEvent(
        candidateId,
        applicationId,
        { kind: 'stage', fromStage: current.stage, toStage: 'archived', occurredAt: now, provenance: 'system' },
        now,
      );
      return this.get(candidateId, applicationId) as StoredApplication;
    });
  }

  restoreFromArchive(
    candidateId: string,
    applicationId: string,
    expectedVersion: number,
    now = new Date().toISOString(),
  ): StoredApplication {
    return this.transaction(() => {
      const current = this.get(candidateId, applicationId);
      if (!current) throw new ApplicationNotFoundError();
      if (current.stage !== 'archived') return current;
      if (current.version !== expectedVersion) {
        throw new ApplicationVersionConflictError(current.version);
      }
      const previousStage = current.archivePreviousStage ?? 'applied';
      const result = this.database
        .prepare(
          `UPDATE applications SET stage = ?,
             closed_reason = CASE WHEN ? = 'rejected' THEN closed_reason ELSE NULL END,
             archive_reason = NULL, archive_previous_stage = NULL,
             stage_changed_at = ?, version = version + 1, updated_at = ?
           WHERE candidate_id = ? AND id = ? AND version = ? AND stage = 'archived'`,
        )
        .run(previousStage, previousStage, now, now, candidateId, applicationId, expectedVersion);
      if (result.changes !== 1) {
        const latest = this.get(candidateId, applicationId);
        if (!latest) throw new ApplicationNotFoundError();
        throw new ApplicationVersionConflictError(latest.version);
      }
      this.insertEvent(
        candidateId,
        applicationId,
        { kind: 'stage', fromStage: 'archived', toStage: previousStage, occurredAt: now, provenance: 'candidate' },
        now,
      );
      return this.get(candidateId, applicationId) as StoredApplication;
    });
  }

  /**
   * Number of applications that ever reached each stage (architecture.md §3):
   * counted from `application_events.to_stage`, not the current `stage`, so a
   * card that passed through `interview` on its way to `rejected` still
   * counts there.
   */
  funnel(candidateId: string): Record<ApplicationStage, number> {
    const rows = this.database
      .prepare(
        `SELECT to_stage AS stage, COUNT(DISTINCT application_id) AS total
           FROM application_events
          WHERE candidate_id = ? AND to_stage IS NOT NULL
          GROUP BY to_stage`,
      )
      .all(candidateId) as unknown as Array<{ stage: ApplicationStage; total: number }>;
    const totals = Object.fromEntries(
      (['saved', 'applied', 'responded', 'interview', 'offer', 'rejected', 'archived'] as const).map(
        (stage) => [stage, 0],
      ),
    ) as Record<ApplicationStage, number>;
    for (const row of rows) totals[row.stage] = row.total;
    return totals;
  }

  /**
   * `POST /vacancy-skips` (architecture.md §4): archives the `saved` card for
   * this `clusterId`, if any, with `closed_reason = reasonId`. A card past
   * `saved` is left alone — a skip never downgrades progress.
   */
  archiveSavedByCluster(
    candidateId: string,
    clusterId: string,
    reasonId: string,
    now = new Date().toISOString(),
  ): void {
    const existing = this.findByCluster(candidateId, clusterId);
    if (!existing || existing.stage !== 'saved') return;
    this.database
      .prepare(
        `UPDATE applications SET stage = 'archived', closed_reason = ?,
           archive_reason = 'candidate', archive_previous_stage = 'saved',
           stage_changed_at = ?, version = version + 1, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(reasonId, now, now, candidateId, existing.id);
    this.insertEvent(
      candidateId,
      existing.id,
      { kind: 'stage', fromStage: 'saved', toStage: 'archived', occurredAt: now, provenance: 'candidate' },
      now,
    );
  }

  /** `PUT /applications/:id/materials/:role`: records the link as a `material` event. */
  recordMaterialEvent(
    candidateId: string,
    applicationId: string,
    role: 'cover_letter' | 'resume',
    documentId: string,
    now = new Date().toISOString(),
  ): void {
    this.insertEvent(
      candidateId,
      applicationId,
      { kind: 'material', fromStage: null, toStage: null, occurredAt: now, provenance: 'candidate' },
      now,
      this.sealedText.seal(JSON.stringify({ role, documentId }), eventAssociatedData(candidateId, applicationId)),
    );
  }

  /**
   * `GET /today` digest (B251, S4, architecture.md §4): how many tracked
   * vacancies the system archived since the candidate's last visit — a plain
   * count query by `candidate_id`, no pool scan.
   */
  countSystemClosuresSince(candidateId: string, since: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM application_events
          WHERE candidate_id = ? AND kind = 'stage' AND to_stage = 'archived'
            AND provenance = 'system' AND occurred_at > ?`,
      )
      .get(candidateId, since) as unknown as { count: number };
    return row.count;
  }

  /**
   * `GET /today` "с прошлого визита" (B251, S4b, architecture.md §57): stage
   * moves the candidate could not have made on their own — the company
   * responding, inviting to interview, sending an offer, or rejecting.
   */
  countCompanyEventsSince(candidateId: string, since: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM application_events
          WHERE candidate_id = ? AND kind = 'stage'
            AND to_stage IN ('responded', 'interview', 'offer', 'rejected')
            AND occurred_at > ?`,
      )
      .get(candidateId, since) as unknown as { count: number };
    return row.count;
  }

  listEvents(candidateId: string, applicationId: string): StoredApplicationEvent[] {
    const rows = this.database
      .prepare(
        `SELECT id, kind, from_stage, to_stage, occurred_at, recorded_at, provenance, payload_cipher
           FROM application_events
          WHERE candidate_id = ? AND application_id = ?
          ORDER BY occurred_at ASC`,
      )
      .all(candidateId, applicationId) as unknown as Array<{
        id: string;
        kind: string;
        from_stage: string | null;
        to_stage: string | null;
        occurred_at: string;
        recorded_at: string;
        provenance: string;
        payload_cipher: string | null;
      }>;
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as ApplicationEventKind,
      fromStage: row.from_stage as ApplicationStage | null,
      toStage: row.to_stage as ApplicationStage | null,
      occurredAt: row.occurred_at,
      recordedAt: row.recorded_at,
      provenance: row.provenance as ApplicationEventProvenance,
      ...(row.kind === 'stage' && row.to_stage === 'applied'
        ? readDeliveryReceipt(row.payload_cipher, this.sealedText, candidateId, applicationId)
        : {}),
    }));
  }

  private insertEvent(
    candidateId: string,
    applicationId: string,
    event: {
      kind: ApplicationEventKind;
      fromStage: ApplicationStage | null;
      toStage: ApplicationStage | null;
      occurredAt: string;
      provenance: ApplicationEventProvenance;
    },
    recordedAt: string,
    payloadCipher: string | null = null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO application_events
          (id, application_id, candidate_id, kind, from_stage, to_stage, occurred_at, recorded_at, provenance, payload_cipher)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        applicationId,
        candidateId,
        event.kind,
        event.fromStage,
        event.toStage,
        event.occurredAt,
        recordedAt,
        event.provenance,
        payloadCipher,
      );
  }

  private persistPatch(
    candidateId: string,
    id: string,
    input: PatchApplicationInput,
    current: StoredApplication,
    nextStage: ApplicationStage,
    stageChanged: boolean,
    occurredAt: string,
    now: string,
    nextNotesCipher: string | null,
    archiveReason: ApplicationArchiveReason | null | undefined,
    archivePreviousStage: ApplicationStage | null | undefined,
  ): StoredApplication {
    const result = this.database
      .prepare(
        `UPDATE applications SET
           stage = ?, notes_cipher = ?, process_profile = ?, follow_up_due_at = ?,
           archive_reason = CASE WHEN ? THEN ? ELSE archive_reason END,
           archive_previous_stage = CASE WHEN ? THEN ? ELSE archive_previous_stage END,
           stage_changed_at = ?, version = version + 1, updated_at = ?
         WHERE candidate_id = ? AND id = ? AND version = ?`,
      )
      .run(
        nextStage,
        nextNotesCipher,
        input.processProfile ?? current.processProfile,
        input.followUpDueAt !== undefined ? input.followUpDueAt : current.followUpDueAt,
        archiveReason !== undefined ? 1 : 0,
        archiveReason ?? null,
        archivePreviousStage !== undefined ? 1 : 0,
        archivePreviousStage ?? null,
        stageChanged ? occurredAt : current.stageChangedAt,
        now,
        candidateId,
        id,
        input.expectedVersion,
      );
    if (result.changes !== 1) {
      const latest = this.get(candidateId, id);
      if (!latest) throw new ApplicationNotFoundError();
      throw new ApplicationVersionConflictError(latest.version);
    }
    if (stageChanged || input.deliveryReceipt !== undefined) {
      this.recordCandidateStageEvent(candidateId, id, current.stage, nextStage, occurredAt, now, input.deliveryReceipt);
    }
    return this.get(candidateId, id) as StoredApplication;
  }

  private recordCandidateStageEvent(
    candidateId: string,
    applicationId: string,
    fromStage: ApplicationStage,
    toStage: ApplicationStage,
    occurredAt: string,
    recordedAt: string,
    deliveryReceipt?: DeliveryReceipt | null,
  ): void {
    this.insertEvent(
      candidateId,
      applicationId,
      { kind: 'stage', fromStage, toStage, occurredAt, provenance: 'candidate' },
      recordedAt,
      deliveryReceipt
        ? this.sealedText.seal(JSON.stringify({ deliveryReceipt }), eventAssociatedData(candidateId, applicationId))
        : null,
    );
  }

  private transaction<T>(operation: () => T): T {
    if (this.database.isTransaction) return operation();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private toApplication(row: ApplicationRow): StoredApplication {
    return {
      id: row.id,
      candidateId: row.candidate_id,
      clusterId: row.cluster_id,
      stage: row.stage as ApplicationStage,
      closedReason: row.closed_reason,
      archiveReason: row.archive_reason ?? (row.stage === 'archived' ? 'unknown' : null),
      archivePreviousStage:
        row.archive_previous_stage ??
        (row.stage === 'archived' ? this.previousArchivedStage(row.candidate_id, row.id) : null),
      processProfile: row.process_profile as ApplicationProcessProfile,
      vacancy: row.vacancy_cipher
        ? (JSON.parse(
            this.sealedText.open(row.vacancy_cipher, vacancyAssociatedData(row.candidate_id, row.id)),
          ) as VacancyApplicationSnapshot)
        : null,
      notes: row.notes_cipher
        ? this.sealedText.open(row.notes_cipher, notesAssociatedData(row.candidate_id, row.id))
        : null,
      followUpDueAt: row.follow_up_due_at,
      stageChangedAt: row.stage_changed_at,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private previousArchivedStage(candidateId: string, applicationId: string): ApplicationStage | null {
    const event = this.database
      .prepare(
        `SELECT from_stage FROM application_events
          WHERE candidate_id = ? AND application_id = ? AND kind = 'stage' AND to_stage = 'archived'
          ORDER BY recorded_at DESC, rowid DESC LIMIT 1`,
      )
      .get(candidateId, applicationId) as { from_stage: string | null } | undefined;
    return event?.from_stage && event.from_stage !== 'archived' && isKnownStage(event.from_stage)
      ? event.from_stage
      : null;
  }
}

function assertClosureEvidence(
  application: StoredApplication,
  evidence: ConfirmedVacancyClosureEvidence,
): void {
  if (
    !application.vacancy?.url ||
    evidence.sourceId !== application.vacancy.source ||
    evidence.vacancyUrl !== application.vacancy.url ||
    !Number.isFinite(Date.parse(evidence.observedAt))
  ) {
    throw new Error('confirmed vacancy closure evidence is required');
  }
}

function isKnownStage(value: string): value is ApplicationStage {
  return ['saved', 'applied', 'responded', 'interview', 'offer', 'rejected', 'archived'].includes(value);
}


function vacancyAssociatedData(candidateId: string, applicationId: string): string {
  return `candidate:${candidateId}:application:${applicationId}:vacancy`;
}

function notesAssociatedData(candidateId: string, applicationId: string): string {
  return `candidate:${candidateId}:application:${applicationId}:notes`;
}

function eventAssociatedData(candidateId: string, applicationId: string): string {
  return `candidate:${candidateId}:application:${applicationId}:event`;
}

function readDeliveryReceipt(
  payloadCipher: string | null,
  sealedText: SealedText,
  candidateId: string,
  applicationId: string,
): { deliveryReceipt: DeliveryReceipt | null } {
  if (!payloadCipher) return { deliveryReceipt: null };
  try {
    const payload = JSON.parse(
      sealedText.open(payloadCipher, eventAssociatedData(candidateId, applicationId)),
    ) as { deliveryReceipt?: DeliveryReceipt };
    const receipt = payload.deliveryReceipt;
    return receipt && typeof receipt.value === 'string' ? { deliveryReceipt: receipt } : { deliveryReceipt: null };
  } catch {
    return { deliveryReceipt: null };
  }
}
