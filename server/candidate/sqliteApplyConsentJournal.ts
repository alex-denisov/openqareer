import type { DatabaseSync } from 'node:sqlite';
import {
  type ApplyConsentEntry,
  type ApplyConsentInput,
  type ApplyConsentPage,
  type ApplyConsentResult,
  MAX_APPLY_CONSENTS_PER_CANDIDATE,
} from '../../shared/applyConsent';
import { SealedText } from '../data/sealedText';

/**
 * B787: журнал только на добавление — записи и их результаты не меняются, стираются лишь вместе
 * с кандидатом. Содержимое записи относится к отклику кандидата и лежит запечатанными.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS apply_consent_journal (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  application_id TEXT,
  mandate_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_cipher TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS apply_consent_journal_candidate
  ON apply_consent_journal (candidate_id, occurred_at);
CREATE TABLE IF NOT EXISTS apply_consent_results (
  entry_id TEXT NOT NULL REFERENCES apply_consent_journal(id) ON DELETE CASCADE,
  result TEXT NOT NULL CHECK (result IN ('sent', 'failed', 'unconfirmed')),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, result)
) STRICT;
`;

interface Row {
  id: string;
  application_id: string | null;
  mandate_version: string;
  occurred_at: string;
  payload_cipher: string;
}

type Payload = Omit<ApplyConsentInput, 'id' | 'applicationId'>;

const scope = (candidateId: string, id: string) => `apply-consent:${candidateId}:${id}`;

function payloadOf({
  host,
  employer,
  checkboxText,
  policyUrl,
  policySha256,
  checkboxLabel,
  command,
}: ApplyConsentInput): Payload {
  return { host, employer, checkboxText, policyUrl, policySha256, checkboxLabel, command };
}

export class SqliteApplyConsentJournal {
  private readonly sealed: SealedText;

  constructor(
    private readonly database: DatabaseSync,
    encryptionKey: Buffer,
  ) {
    this.sealed = new SealedText(encryptionKey);
    this.database.exec(SCHEMA);
  }

  ownsApplication(candidateId: string, applicationId: string): boolean {
    return (
      this.database
        .prepare('SELECT 1 FROM applications WHERE id = ? AND candidate_id = ?')
        .get(applicationId, candidateId) !== undefined
    );
  }

  /** `conflict` — номер занят другой записью или другим кандидатом; `full` — записей уже предельно много. */
  append(
    candidateId: string,
    input: ApplyConsentInput,
    meta: { readonly mandateVersion: string; readonly now: Date },
  ): 'created' | 'existing' | 'conflict' | 'full' {
    const payload = JSON.stringify(payloadOf(input));
    const inserted = this.database
      .prepare(
        `INSERT INTO apply_consent_journal
           (id, candidate_id, application_id, mandate_version, occurred_at, payload_cipher)
         SELECT ?, ?, ?, ?, ?, ?
          WHERE (SELECT COUNT(*) FROM apply_consent_journal WHERE candidate_id = ?) < ?
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        input.id,
        candidateId,
        input.applicationId,
        meta.mandateVersion,
        meta.now.toISOString(),
        this.sealed.seal(payload, scope(candidateId, input.id)),
        candidateId,
        MAX_APPLY_CONSENTS_PER_CANDIDATE,
      );
    if (Number(inserted.changes) === 1) return 'created';
    const [stored] = this.select(candidateId, 'AND id = ?', [input.id]);
    if (!stored && !this.idTaken(input.id)) return 'full';
    return stored?.application_id === input.applicationId &&
      this.sealed.open(stored.payload_cipher, scope(candidateId, input.id)) === payload
      ? 'existing'
      : 'conflict';
  }

  private idTaken(id: string): boolean {
    return (
      this.database.prepare('SELECT 1 FROM apply_consent_journal WHERE id = ?').get(id) !==
      undefined
    );
  }

  /** Результаты дописываются: отклик мог подтвердиться позже неудачной попытки. */
  appendResult(candidateId: string, id: string, result: ApplyConsentResult, now: Date): boolean {
    if (this.select(candidateId, 'AND id = ?', [id]).length === 0) return false;
    this.database
      .prepare(
        `INSERT INTO apply_consent_results (entry_id, result, recorded_at)
         VALUES (?, ?, ?) ON CONFLICT(entry_id, result) DO NOTHING`,
      )
      .run(id, result, now.toISOString());
    return true;
  }

  list(
    candidateId: string,
    page: { readonly applicationId?: string; readonly limit: number; readonly offset: number },
  ): ApplyConsentPage {
    const filter = page.applicationId ? 'AND application_id = ?' : '';
    const values = page.applicationId ? [page.applicationId] : [];
    const count = this.database
      .prepare(
        `SELECT COUNT(*) AS total FROM apply_consent_journal WHERE candidate_id = ? ${filter}`,
      )
      .get(candidateId, ...values) as { total: number };
    const rows = this.select(
      candidateId,
      `${filter} ORDER BY occurred_at DESC, id LIMIT ? OFFSET ?`,
      [...values, page.limit, page.offset],
    );
    return { entries: rows.flatMap((row) => this.toEntry(candidateId, row)), total: count.total };
  }

  exportAll(candidateId: string): readonly ApplyConsentEntry[] {
    return this.select(candidateId, 'ORDER BY occurred_at, id', []).flatMap((row) =>
      this.toEntry(candidateId, row),
    );
  }

  private select(candidateId: string, tail: string, values: readonly (string | number)[]): Row[] {
    return this.database
      .prepare(
        `SELECT id, application_id, mandate_version, occurred_at, payload_cipher
           FROM apply_consent_journal WHERE candidate_id = ? ${tail}`,
      )
      .all(candidateId, ...values) as unknown as Row[];
  }

  /** Повреждённая запись не прячет остальные. */
  private toEntry(candidateId: string, row: Row): ApplyConsentEntry[] {
    let payload: Payload;
    try {
      payload = JSON.parse(
        this.sealed.open(row.payload_cipher, scope(candidateId, row.id)),
      ) as Payload;
    } catch {
      return [];
    }
    const results = this.database
      .prepare(
        'SELECT result, recorded_at AS at FROM apply_consent_results WHERE entry_id = ? ORDER BY recorded_at, rowid',
      )
      .all(row.id) as unknown as ApplyConsentEntry['results'];
    return [
      {
        ...payload,
        id: row.id,
        applicationId: row.application_id,
        mandateVersion: row.mandate_version,
        occurredAt: row.occurred_at,
        results: results.map((item) => ({ ...item })),
      },
    ];
  }
}
