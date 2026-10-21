import type { CandidateStore } from '../data/candidateStore';
import type { PasswordResetDelivery } from './authTypes';
import type { EmailDomainDnsFailure, EmailDomainResolver } from './emailDomainCheck';

/** Rolling sessions expire after 30 days without activity (owner decision 2026-09-20). */
export const SESSION_IDLE_DAYS = 30;
export const SESSION_IDLE_MS = SESSION_IDLE_DAYS * 24 * 60 * 60 * 1_000;
export const PASSWORD_RESET_HOURS = 1;

export interface AuthServiceOptions {
  databasePath: string;
  onPasswordReset?: (input: PasswordResetDelivery) => Promise<void>;
  candidateStore?: CandidateStore;
  emailDomainResolver?: EmailDomainResolver;
  emailMxCheckBypassDomains?: readonly string[];
  onEmailDomainDnsFailure?: (failure: EmailDomainDnsFailure) => void;
}
