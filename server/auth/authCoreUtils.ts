import { createHash, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import type { CandidateIdentity } from '../data/candidateStore';
import type { AccountSnapshot, AuthPrincipal, UserRole } from './authTypes';
import { AuthDisposableEmailError } from './authErrors';
import { canonicalizeEmail, validateEmailAddress } from './emailNormalization';

const scrypt = promisify(scryptCallback);

export interface UserRow {
  id: string;
  username: string;
  role: UserRole;
  password_salt: string;
  password_hash: string;
  is_test: number;
  candidate_id: string | null;
  data_class: CandidateIdentity['dataClass'] | null;
  locale: CandidateIdentity['locale'] | null;
  candidate_created_at: string | null;
  user_created_at: string;
  email: string | null;
  display_name: string | null;
  headline: string | null;
  location: string | null;
  work_mode: AccountSnapshot['profile']['workMode'];
  timezone: string | null;
  blocked_at: string | null;
  profile_updated_at: string | null;
}

export interface PasswordResetRow extends UserRow {
  reset_expires_at: string;
}

export async function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password, salt, 64)) as Buffer;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function normalizeEmail(email: string): string {
  return canonicalizeEmail(email);
}

export function canonicalEmailOrThrow(email: string): string {
  const result = validateEmailAddress(email);
  if (result.valid) return result.canonicalEmail;
  if (result.reason === 'disposable') throw new AuthDisposableEmailError(result.message);
  throw new Error(result.message);
}

export function principalFromRow(row: UserRow): AuthPrincipal {
  return {
    userId: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isTest: row.is_test === 1,
    candidate:
      row.candidate_id && row.data_class && row.locale && row.candidate_created_at
        ? {
            id: row.candidate_id,
            dataClass: row.data_class,
            locale: row.locale,
            createdAt: row.candidate_created_at,
          }
        : null,
  };
}
