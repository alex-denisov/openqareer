import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { diffProfileDrafts } from '../domain/profileChangeDiff';
import type { ResumeDraft } from '../domain/resumeDraft';
import { PROFILE_CHANGE_LOG_MIGRATION } from './profileChangeLogSchema';
import type { SealedText } from './sealedText';

export const PROFILE_CHANGE_ACTORS = ['candidate', 'consultant', 'import', 'skill_check'] as const;
export type ProfileChangeActor = (typeof PROFILE_CHANGE_ACTORS)[number];
export type ProfileChangeKind = 'value' | 'confirmation';

/** A fact's trust before a change touched it; restored on revert. */
export interface FactTrustState {
  readonly memoryId: string;
  readonly status: string;
  readonly confidence: string;
}

export interface ProfileChangeEntry {
  readonly id: string;
  readonly candidateId: string;
  readonly actor: ProfileChangeActor;
  /** Profile section key (headline, about, experience, education, …). */
  readonly section: string;
  /** 'confirmation': the candidate confirmed the item's facts; text is unchanged. */
  readonly kind: ProfileChangeKind;
  readonly itemId: string | null;
  /** Human label of the changed item, e.g. «Руководитель продукта · Ozon». */
  readonly label: string;
  readonly previous: string;
  readonly applied: string;
  readonly commandId: string | null;
  readonly factStates: readonly FactTrustState[];
  readonly createdAt: string;
  readonly revertedAt: string | null;
}

export type NewProfileChange = Omit<ProfileChangeEntry, 'revertedAt' | 'factStates' | 'kind'> & {
  readonly kind?: ProfileChangeKind;
  readonly factStates?: readonly FactTrustState[];
};

interface ChangeRow {
  id: string;
  candidate_id: string;
  actor: ProfileChangeActor;
  section: string;
  kind: ProfileChangeKind;
  item_id: string | null;
  label_cipher: string;
  previous_cipher: string;
  applied_cipher: string;
  command_id: string | null;
  fact_states_json: string;
  created_at: string;
  reverted_at: string | null;
}

type SealedField = 'label' | 'previous' | 'applied';

const SELECT_COLUMNS = `id, candidate_id, actor, section, kind, item_id, label_cipher, previous_cipher,
  applied_cipher, command_id, fact_states_json, created_at, reverted_at`;

/** Journal of every profile change, plus the fact-trust writes that accepts and reverts need. */
export class SqliteProfileChangeLogRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(PROFILE_CHANGE_LOG_MIGRATION);
  }

  record(input: NewProfileChange): ProfileChangeEntry {
    const factStates = input.factStates ?? [];
    const kind = input.kind ?? 'value';
    this.database
      .prepare(
        `INSERT INTO profile_change_log (${SELECT_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.candidateId,
        input.actor,
        input.section,
        kind,
        input.itemId,
        this.seal(input.candidateId, input.id, 'label', input.label),
        this.seal(input.candidateId, input.id, 'previous', input.previous),
        this.seal(input.candidateId, input.id, 'applied', input.applied),
        input.commandId,
        JSON.stringify(factStates),
        input.createdAt,
      );
    return { ...input, kind, factStates, revertedAt: null };
  }

  /** Logs each changed section item between two drafts as one entry by `actor`. */
  recordDraftChanges(
    candidateId: string,
    previous: ResumeDraft | undefined,
    next: ResumeDraft,
    actor: Exclude<ProfileChangeActor, 'consultant'>,
  ): void {
    const createdAt = new Date().toISOString();
    for (const change of diffProfileDrafts(previous, next)) {
      this.record({ ...change, id: randomUUID(), candidateId, actor, commandId: null, createdAt });
    }
  }

  /** Newest first; `page` starts at 0. */
  list(
    candidateId: string,
    page: number,
    pageSize: number,
  ): { entries: ProfileChangeEntry[]; total: number } {
    const rows = this.database
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM profile_change_log
         WHERE candidate_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(candidateId, pageSize, page * pageSize) as unknown as ChangeRow[];
    const { total } = this.database
      .prepare('SELECT COUNT(*) AS total FROM profile_change_log WHERE candidate_id = ?')
      .get(candidateId) as { total: number };
    return { entries: rows.map((row) => this.mapRow(row)), total };
  }

  get(candidateId: string, id: string): ProfileChangeEntry | null {
    const row = this.database
      .prepare(`SELECT ${SELECT_COLUMNS} FROM profile_change_log WHERE candidate_id = ? AND id = ?`)
      .get(candidateId, id) as unknown as ChangeRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByCommandId(candidateId: string, commandId: string): ProfileChangeEntry | null {
    const row = this.database
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM profile_change_log
         WHERE candidate_id = ? AND command_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(candidateId, commandId) as unknown as ChangeRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  markReverted(candidateId: string, id: string, revertedAt: string): void {
    this.database
      .prepare(
        `UPDATE profile_change_log SET reverted_at = ?
         WHERE candidate_id = ? AND id = ? AND reverted_at IS NULL`,
      )
      .run(revertedAt, candidateId, id);
  }

  /** Current trust of live facts; deleted or unknown ids are skipped. */
  readFactStates(candidateId: string, memoryIds: readonly string[]): FactTrustState[] {
    const read = this.database.prepare(
      `SELECT id, status, confidence FROM memory
       WHERE candidate_id = ? AND id = ? AND status != 'deleted'`,
    );
    return [...new Set(memoryIds)].flatMap((memoryId) => {
      const row = read.get(candidateId, memoryId) as
        | { id: string; status: string; confidence: string }
        | undefined;
      return row ? [{ memoryId: row.id, status: row.status, confidence: row.confidence }] : [];
    });
  }

  writeFactStates(candidateId: string, states: readonly FactTrustState[], at: string): void {
    const write = this.database.prepare(
      `UPDATE memory SET status = ?, confidence = ?, updated_at = ?
       WHERE candidate_id = ? AND id = ? AND status != 'deleted'`,
    );
    for (const state of states) {
      write.run(state.status, state.confidence, at, candidateId, state.memoryId);
    }
  }

  /** Command ids that already have a history entry. */
  commandIds(candidateId: string): Set<string> {
    const rows = this.database
      .prepare(
        `SELECT command_id FROM profile_change_log
         WHERE candidate_id = ? AND command_id IS NOT NULL`,
      )
      .all(candidateId) as unknown as { command_id: string }[];
    return new Set(rows.map((row) => row.command_id));
  }

  /** Facts the candidate confirmed together with the consultant, with the latest date. */
  consultantConfirmations(candidateId: string): Map<string, string> {
    const rows = this.database
      .prepare(
        `SELECT fact_states_json, created_at FROM profile_change_log
         WHERE candidate_id = ? AND actor = 'consultant' AND reverted_at IS NULL
         ORDER BY created_at ASC`,
      )
      .all(candidateId) as unknown as Pick<ChangeRow, 'fact_states_json' | 'created_at'>[];
    return new Map(
      rows.flatMap((row) =>
        (JSON.parse(row.fact_states_json) as FactTrustState[]).map(
          (state) => [state.memoryId, row.created_at] as const,
        ),
      ),
    );
  }

  private mapRow(row: ChangeRow): ProfileChangeEntry {
    const open = (field: SealedField, cipher: string) =>
      this.sealedText.open(cipher, associatedData(row.candidate_id, row.id, field));
    return {
      id: row.id,
      candidateId: row.candidate_id,
      actor: row.actor,
      section: row.section,
      kind: row.kind,
      itemId: row.item_id,
      label: open('label', row.label_cipher),
      previous: open('previous', row.previous_cipher),
      applied: open('applied', row.applied_cipher),
      commandId: row.command_id,
      factStates: JSON.parse(row.fact_states_json) as FactTrustState[],
      createdAt: row.created_at,
      revertedAt: row.reverted_at,
    };
  }

  private seal(candidateId: string, id: string, field: SealedField, value: string): string {
    return this.sealedText.seal(value, associatedData(candidateId, id, field));
  }
}

function associatedData(candidateId: string, id: string, field: SealedField): string {
  return `candidate:${candidateId}:profile-change:${id}:${field}`;
}
