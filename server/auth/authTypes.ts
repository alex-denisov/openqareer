import type { CandidateIdentity, CandidateStore } from '../data/candidateStore';

export type UserRole = 'candidate' | 'admin';

export interface AuthPrincipal {
  userId: string;
  username: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  isTest: boolean;
  candidate: CandidateIdentity | null;
}

export interface RegistrationProfile {
  email?: string;
  displayName?: string;
}

export interface AccountSnapshot {
  username: string;
  email: string | null;
  displayName: string | null;
  profile: {
    headline: string | null;
    location: string | null;
    workMode: 'office' | 'hybrid' | 'remote' | 'flexible' | null;
    updatedAt: string | null;
  };
  sessions: Array<{
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }>;
}

export interface AccountProfileUpdate {
  email?: string | null;
  displayName?: string | null;
  headline?: string | null;
  location?: string | null;
  workMode?: AccountSnapshot['profile']['workMode'];
}

export interface PasswordResetDelivery {
  email: string;
  displayName: string | null;
  token: string;
}

export interface SeedAccount {
  username: string;
  password: string;
  role: UserRole;
}

export type SubscriptionTier = 'free' | 'pro' | 'executive' | 'enterprise';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface AdminUserRecord {
  id: string;
  username: string;
  role: UserRole;
  isTest: boolean;
  email: string | null;
  displayName: string | null;
  headline: string | null;
  location: string | null;
  workMode: string | null;
  candidateId: string | null;
  blockedAt: string | null;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: string | null;
  subscriptionNotes: string | null;
  createdAt: string;
  activeSessions: number;
  lastSeenAt: string | null;
}

export interface AdminUserPage {
  total: number;
  users: AdminUserRecord[];
}

export interface AdminUserQuery {
  query?: string;
  limit: number;
  offset: number;
}

interface AdminAuditRecord {
  id: string;
  actorUserId: string;
  actorUsername: string;
  action: string;
  subjectUserId: string | null;
  subjectUsername: string | null;
  detail: string | null;
  createdAt: string;
}

export interface AdminAuditPage {
  total: number;
  records: AdminAuditRecord[];
}

export interface AdminUserUpdateInput {
  email?: string | null;
  displayName?: string | null;
  headline?: string | null;
  location?: string | null;
  workMode?: string | null;
  role?: UserRole;
  subscriptionTier?: SubscriptionTier;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionExpiresAt?: string | null;
  subscriptionNotes?: string | null;
}

export interface SessionAuth {
  register(
    usernameInput: string,
    password: string,
    candidateStore: CandidateStore,
    profile?: RegistrationProfile,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }>;
  login(
    identifierInput: string,
    password: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null>;
  isUsernameTaken(username: string): boolean;
  authenticate(sessionToken: string): AuthPrincipal | null;
  logout(sessionToken: string): void;
  getAccount?(sessionToken: string): AccountSnapshot | null;
  /** B173: proof of which published documents the account accepted, and when. */
  recordLegalConsent?(input: {
    userId: string;
    versionId: string;
    documents: readonly string[];
    acceptedAt?: string;
  }): void;
  listUsers?(input: AdminUserQuery): AdminUserPage;
  getUser?(userId: string): AdminUserRecord | null;
  setUserRole?(
    targetUserId: string,
    newRole: UserRole,
    actorPrincipal?: AuthPrincipal,
  ): AdminUserRecord;
  setUserBlocked?(
    targetUserId: string,
    blocked: boolean,
    actorPrincipal?: AuthPrincipal,
  ): AdminUserRecord;
  updateUserByAdmin?(
    targetUserId: string,
    input: AdminUserUpdateInput,
    actorPrincipal?: AuthPrincipal,
  ): AdminUserRecord;
  adminSetUserPassword?(
    targetUserId: string,
    newPassword: string,
    actorPrincipal?: AuthPrincipal,
  ): Promise<void>;
  impersonateUser?(
    targetUserId: string,
    actorPrincipal?: AuthPrincipal,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }>;
  deleteUserByAdmin?(
    targetUserId: string,
    actorPrincipal?: AuthPrincipal,
  ): void;
  listAudit?(query?: { limit: number; offset: number }): AdminAuditPage;
  updateAccount?(
    sessionToken: string,
    input: AccountProfileUpdate,
  ): AccountSnapshot | null;
  changePassword?(
    sessionToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null>;
  requestPasswordReset?(identifier: string): Promise<void>;
  resetPassword?(
    token: string,
    newPassword: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }>;
  revokeOtherSessions?(sessionToken: string): number | null;
}
