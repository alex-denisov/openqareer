import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CoachMessage } from '../../domain/coach';
import type {
  CandidateIdentity,
  StoredMemory,
  TurnRequest,
} from '../candidateStore';
import type { CoachProviderResult } from '../../providers/coachProvider';
import type { SealedText } from '../sealedText';
import type { OAuthPlatform } from '../../connectors/oauthTypes';

export interface StoreContext {
  database: DatabaseSync;
  sealedText: SealedText;
}

export interface SqliteStoreOptions {
  databasePath: string;
  encryptionKey: Buffer;
}

export interface CandidateRow {
  id: string;
  data_class: CandidateIdentity['dataClass'];
  locale: CandidateIdentity['locale'];
  created_at: string;
}

export interface MessageRow {
  id: string;
  role: CoachMessage['role'];
  body_cipher: string;
  created_at: string;
}

export interface MemoryRow {
  id: string;
  kind: StoredMemory['kind'];
  domain: StoredMemory['domain'];
  statement_cipher: string;
  confidence: StoredMemory['confidence'];
  source_message_ids: string;
  sensitive: number;
  status: StoredMemory['status'] | 'deleted';
  created_at: string;
  updated_at: string;
}

export interface TurnRow {
  idempotency_key: string;
  status: 'pending' | 'failed' | 'completed';
  phase: TurnRequest['phase'];
  user_message_id: string;
  request_digest: string | null;
  result_cipher: string | null;
  provider: CoachProviderResult['provider'] | null;
  model: string | null;
  response_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
  updated_at: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function turnRequestDigest(request: TurnRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        request.messageId,
        request.content,
        request.marketQuery ?? null,
      ]),
    )
    .digest('hex');
}

export function candidateFromRow(row: CandidateRow): CandidateIdentity {
  return {
    id: row.id,
    dataClass: row.data_class,
    locale: row.locale,
    createdAt: row.created_at,
  };
}

export function messageAssociatedData(
  candidateId: string,
  messageId: string,
): string {
  return `candidate:${candidateId}:message:${messageId}`;
}

export function memoryAssociatedData(
  candidateId: string,
  memoryId: string,
): string {
  return `candidate:${candidateId}:memory:${memoryId}`;
}

export function turnAssociatedData(
  candidateId: string,
  idempotencyKey: string,
): string {
  return `candidate:${candidateId}:turn:${idempotencyKey}`;
}

export function oauthAuthorizationAssociatedData(
  candidateId: string,
  platform: OAuthPlatform,
  stateDigest: string,
): string {
  return `candidate:${candidateId}:oauth:${platform}:authorization:${stateDigest}`;
}

export function oauthConnectionAssociatedData(
  candidateId: string,
  platform: OAuthPlatform,
): string {
  return `candidate:${candidateId}:oauth:${platform}:connection`;
}
