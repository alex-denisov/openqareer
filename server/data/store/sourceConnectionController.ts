import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ImportedResumeEvidence,
  NativeSourceReceiptInput,
  StoredNativeSourceConnection,
} from '../candidateStore';
import type { SealedText } from '../sealedText';
import type { StoreContext } from './shared';

interface SourceConnectionRow {
  id: string;
  candidate_id: string;
  platform: NativeSourceReceiptInput['platform'];
  access_mode: NativeSourceReceiptInput['accessMode'];
  receipt_cipher: string;
  import_digest: string;
  connected_at: string;
  last_imported_at: string;
}

interface StoredReceipt {
  sourceUrl: string;
  capturedAt: string;
  sourceMessageId: string;
  memoryIds: string[];
  factCount: number;
}

export class SourceConnectionController {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;

  constructor(context: StoreContext) {
    this.database = context.database;
    this.sealedText = context.sealedText;
  }

  findByDigest(
    candidateId: string,
    platform: NativeSourceReceiptInput['platform'],
    importDigest: string,
  ): StoredNativeSourceConnection | null {
    const row = this.database
      .prepare(
        `SELECT id, candidate_id, platform, access_mode, receipt_cipher,
                import_digest, connected_at, last_imported_at
         FROM candidate_source_connections
         WHERE candidate_id = ? AND platform = ? AND import_digest = ?`,
      )
      .get(candidateId, platform, importDigest) as SourceConnectionRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  list(candidateId: string): StoredNativeSourceConnection[] {
    const rows = this.database
      .prepare(
        `SELECT id, candidate_id, platform, access_mode, receipt_cipher,
                import_digest, connected_at, last_imported_at
         FROM candidate_source_connections
         WHERE candidate_id = ? ORDER BY platform`,
      )
      .all(candidateId) as unknown as SourceConnectionRow[];
    return rows.map((row) => this.fromRow(row));
  }

  delete(
    candidateId: string,
    platform: NativeSourceReceiptInput['platform'],
  ): boolean {
    return (
      this.database
        .prepare(
          `DELETE FROM candidate_source_connections
           WHERE candidate_id = ? AND platform = ?`,
        )
        .run(candidateId, platform).changes === 1
    );
  }

  upsert(
    candidateId: string,
    input: NativeSourceReceiptInput,
    evidence: ImportedResumeEvidence,
  ): StoredNativeSourceConnection {
    validateSourceReceipt(input);
    const existing = this.list(candidateId).find(
      (connection) => connection.platform === input.platform,
    );
    const now = new Date().toISOString();
    const id = existing?.id ?? randomUUID();
    const connectedAt = existing?.connectedAt ?? now;
    const receipt: StoredReceipt = {
      sourceUrl: input.sourceUrl,
      capturedAt: input.capturedAt,
      sourceMessageId: evidence.messageId,
      memoryIds: [...evidence.memoryIds],
      factCount: evidence.memoryIds.length,
    };
    this.persist({
      id,
      candidateId,
      input,
      evidence,
      receipt,
      connectedAt,
      now,
    });
    return {
      id,
      candidateId,
      platform: input.platform,
      accessMode: input.accessMode,
      connectedAt,
      lastImportedAt: now,
      receipt,
    };
  }

  private persist(context: {
    id: string;
    candidateId: string;
    input: NativeSourceReceiptInput;
    evidence: ImportedResumeEvidence;
    receipt: StoredReceipt;
    connectedAt: string;
    now: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO candidate_source_connections
          (id, candidate_id, platform, access_mode, source_message_id,
           receipt_cipher, import_digest, connected_at, last_imported_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, platform) DO UPDATE SET
           id = excluded.id,
           access_mode = excluded.access_mode,
           source_message_id = excluded.source_message_id,
           receipt_cipher = excluded.receipt_cipher,
           import_digest = excluded.import_digest,
           last_imported_at = excluded.last_imported_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        context.id,
        context.candidateId,
        context.input.platform,
        context.input.accessMode,
        context.evidence.messageId,
        this.sealedText.seal(
          JSON.stringify(context.receipt),
          associatedData(context.candidateId, context.input.platform),
        ),
        context.input.importDigest,
        context.connectedAt,
        context.now,
        context.now,
      );
  }

  private fromRow(row: SourceConnectionRow): StoredNativeSourceConnection {
    const receipt = JSON.parse(
      this.sealedText.open(
        row.receipt_cipher,
        associatedData(row.candidate_id, row.platform),
      ),
    ) as StoredReceipt;
    return {
      id: row.id,
      candidateId: row.candidate_id,
      platform: row.platform,
      accessMode: row.access_mode,
      connectedAt: row.connected_at,
      lastImportedAt: row.last_imported_at,
      receipt,
    };
  }
}

function validateSourceReceipt(input: NativeSourceReceiptInput): void {
  if (!/^[a-f0-9]{64}$/u.test(input.importDigest)) {
    throw new Error('native source import digest is invalid');
  }
  const capturedAt = Date.parse(input.capturedAt);
  if (!Number.isFinite(capturedAt)) {
    throw new Error('native source capturedAt is invalid');
  }
  const url = new URL(input.sourceUrl);
  if (
    input.platform === 'hh' &&
    (url.protocol !== 'https:' || url.hostname !== 'hh.ru' || !url.pathname.startsWith('/resume/'))
  ) {
    throw new Error('native hh source URL is invalid');
  }
  if (
    input.platform === 'linkedin' &&
    (url.protocol !== 'https:' ||
      !(
        url.hostname === 'linkedin.com' ||
        url.hostname.endsWith('.linkedin.com') ||
        url.hostname === 'linkedin.cn' ||
        url.hostname.endsWith('.linkedin.cn')
      ) ||
      !/^\/in\/[^/]{2,200}\/?$/u.test(url.pathname))
  ) {
    throw new Error('native LinkedIn source URL is invalid');
  }
}

function associatedData(
  candidateId: string,
  platform: NativeSourceReceiptInput['platform'],
): string {
  return `candidate:${candidateId}:native-source:${platform}:receipt`;
}
