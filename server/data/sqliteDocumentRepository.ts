import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  CandidateDocumentInput,
  CandidateDocumentWithContent,
  StoredCandidateDocument,
} from './candidateStore';
import type { SealedText } from './sealedText';

const MAX_DOCUMENT_BYTES = 5 * 1_024 * 1_024;
const MAX_EXTRACTED_TEXT = 200_000;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/json',
]);

interface DocumentRow {
  id: string;
  family_id: string;
  version: number;
  kind: StoredCandidateDocument['kind'];
  source: StoredCandidateDocument['source'];
  file_name_cipher: string;
  mime_type: string;
  byte_size: number;
  content_sha256: string;
  content_cipher: string | null;
  extracted_text_cipher: string | null;
  parse_status: StoredCandidateDocument['parseStatus'];
  supersedes_document_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DocumentIdentity {
  id: string;
  familyId: string;
  version: number;
  previousId: string | null;
}

export class SqliteDocumentRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  save(
    candidateId: string,
    input: CandidateDocumentInput,
  ): { created: boolean; document: StoredCandidateDocument } {
    const normalized = normalizeInput(input);
    const sha256 = createHash('sha256')
      .update(normalized.bytes)
      .digest('hex');
    const duplicate = this.findByHash(candidateId, sha256);
    if (duplicate) {
      return { created: false, document: this.metadata(candidateId, duplicate) };
    }
    const previous = input.replacesDocumentId
      ? this.find(candidateId, input.replacesDocumentId)
      : null;
    if (input.replacesDocumentId && !previous) {
      throw new CandidateDocumentVersionError();
    }
    if (previous && previous.kind !== input.kind) {
      throw new CandidateDocumentVersionError();
    }
    const id = randomUUID();
    const familyId = previous?.family_id ?? randomUUID();
    const version = (previous?.version ?? 0) + 1;
    this.insertDocument(candidateId, input, normalized, {
      id,
      familyId,
      version,
      previousId: previous?.id ?? null,
    });
    const stored = this.find(candidateId, id);
    if (!stored) throw new Error('candidate document was not persisted');
    return { created: true, document: this.metadata(candidateId, stored) };
  }

  private insertDocument(
    candidateId: string,
    input: CandidateDocumentInput,
    normalized: ReturnType<typeof normalizeInput>,
    identity: DocumentIdentity,
  ): void {
    const now = new Date().toISOString();
    const sha256 = createHash('sha256').update(normalized.bytes).digest('hex');
    this.database
      .prepare(
        `INSERT INTO candidate_documents
          (id, candidate_id, family_id, version, kind, source,
           file_name_cipher, mime_type, byte_size, content_sha256,
           content_cipher, extracted_text_cipher, parse_status,
           supersedes_document_id, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        identity.id,
        candidateId,
        identity.familyId,
        identity.version,
        input.kind,
        input.source,
        this.sealedText.seal(
          normalized.fileName,
          associatedData(candidateId, identity.id, 'file-name'),
        ),
        normalized.mimeType,
        normalized.bytes.length,
        sha256,
        this.sealedText.seal(
          normalized.bytes.toString('base64'),
          associatedData(candidateId, identity.id, 'content'),
        ),
        normalized.extractedText
          ? this.sealedText.seal(
              normalized.extractedText,
              associatedData(candidateId, identity.id, 'extracted-text'),
            )
          : null,
        input.parseStatus,
        identity.previousId,
        now,
        now,
      );
  }

  list(candidateId: string): StoredCandidateDocument[] {
    return this.rows(candidateId).map((row) => this.metadata(candidateId, row));
  }

  get(
    candidateId: string,
    documentId: string,
  ): CandidateDocumentWithContent | null {
    const row = this.find(candidateId, documentId);
    if (!row?.content_cipher) return null;
    return {
      ...this.metadata(candidateId, row),
      contentBase64: this.sealedText.open(
        row.content_cipher,
        associatedData(candidateId, row.id, 'content'),
      ),
      extractedText: row.extracted_text_cipher
        ? this.sealedText.open(
            row.extracted_text_cipher,
            associatedData(candidateId, row.id, 'extracted-text'),
          )
        : null,
    };
  }

  delete(candidateId: string, documentId: string): boolean {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE candidate_documents
         SET content_cipher = NULL, extracted_text_cipher = NULL,
             deleted_at = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ? AND deleted_at IS NULL`,
      )
      .run(now, now, candidateId, documentId);
    return result.changes === 1;
  }

  private rows(candidateId: string): DocumentRow[] {
    return this.database
      .prepare(
        `${DOCUMENT_SELECT}
         WHERE candidate_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC, id`,
      )
      .all(candidateId) as unknown as DocumentRow[];
  }

  private find(candidateId: string, documentId: string): DocumentRow | null {
    return (
      (this.database
        .prepare(
          `${DOCUMENT_SELECT}
           WHERE candidate_id = ? AND id = ? AND deleted_at IS NULL`,
        )
        .get(candidateId, documentId) as DocumentRow | undefined) ?? null
    );
  }

  private findByHash(candidateId: string, sha256: string): DocumentRow | null {
    return (
      (this.database
        .prepare(
          `${DOCUMENT_SELECT}
           WHERE candidate_id = ? AND content_sha256 = ? AND deleted_at IS NULL`,
        )
        .get(candidateId, sha256) as DocumentRow | undefined) ?? null
    );
  }

  private metadata(
    candidateId: string,
    row: DocumentRow,
  ): StoredCandidateDocument {
    return {
      id: row.id,
      familyId: row.family_id,
      version: row.version,
      kind: row.kind,
      source: row.source,
      fileName: this.sealedText.open(
        row.file_name_cipher,
        associatedData(candidateId, row.id, 'file-name'),
      ),
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      sha256: row.content_sha256,
      parseStatus: row.parse_status,
      supersedesDocumentId: row.supersedes_document_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class CandidateDocumentVersionError extends Error {
  constructor() {
    super('replacement document must belong to the same candidate and kind');
    this.name = 'CandidateDocumentVersionError';
  }
}

export class CandidateDocumentValidationError extends Error {
  constructor() {
    super('candidate document is invalid');
    this.name = 'CandidateDocumentValidationError';
  }
}

const DOCUMENT_SELECT = `
  SELECT id, family_id, version, kind, source, file_name_cipher, mime_type,
         byte_size, content_sha256, content_cipher, extracted_text_cipher,
         parse_status, supersedes_document_id, created_at, updated_at
  FROM candidate_documents
`;

function normalizeInput(input: CandidateDocumentInput) {
  const fileName = input.fileName.trim();
  const mimeType = input.mimeType.trim().toLowerCase();
  const extractedText = input.extractedText?.trim() || null;
  const encoded = input.contentBase64.trim();
  if (
    !fileName ||
    fileName.length > 240 ||
    hasUnsafeFileNameCharacter(fileName) ||
    !ALLOWED_MIME_TYPES.has(mimeType) ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) ||
    (extractedText?.length ?? 0) > MAX_EXTRACTED_TEXT
  ) {
    throw new CandidateDocumentValidationError();
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length === 0 ||
    bytes.length > MAX_DOCUMENT_BYTES ||
    bytes.toString('base64').replace(/=+$/u, '') !==
      encoded.replace(/=+$/u, '')
  ) {
    throw new CandidateDocumentValidationError();
  }
  return { fileName, mimeType, extractedText, bytes };
}

function hasUnsafeFileNameCharacter(value: string): boolean {
  return [...value].some(
    (character) =>
      character === '/' || character === '\\' || character.charCodeAt(0) < 32,
  );
}

function associatedData(
  candidateId: string,
  documentId: string,
  field: 'file-name' | 'content' | 'extracted-text',
): string {
  return `candidate:${candidateId}:document:${documentId}:${field}`;
}
