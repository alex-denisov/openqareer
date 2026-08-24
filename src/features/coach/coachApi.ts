type UserRole = 'candidate' | 'admin';
type CoachPhase = 'discovery' | 'evidence' | 'role' | 'market' | 'resume' | 'targeting';
import {
  apiFetch,
  readData,
  readDataArray,
  readDataObject,
  setStoredSessionToken,
  throwApiError,
} from './apiClient';
export { CoachApiError } from './apiClient';
import type {
  AccountSnapshot,
  CandidateDocument,
  CandidateDocumentKind,
  MatchedVacancyItem,
  VacancySubscription,
  VacancySubscriptionView,
  VacancySourceId,
  VacancySourceRegistryEntry,
} from './cabinetTypes';
export type {
  AccountSnapshot,
  CandidateDocument,
  CandidateDocumentKind,
  MatchedVacancyItem,
  VacancySubscription,
  VacancySubscriptionView,
  VacancySourceId,
  VacancySourceRegistryEntry,
} from './cabinetTypes';



export interface AuthUser {
  username: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  isTest: boolean;
  candidateId: string | null;
  sessionToken?: string;
}

export type CandidateConnection = {
  platform: 'linkedin' | 'hh';
  available: boolean;
  capabilities: Array<'lite_identity' | 'profile_read' | 'resume_read'>;
  importsCareerHistory: boolean;
} & (
  | { status: 'disconnected' }
  | {
      status: 'connected';
      accessMode?: never;
      scopes: string[];
      accessTokenExpiresAt: string | null;
      connectedAt: string;
      profile: {
        capturedAt: string;
        sourceUrl: string | null;
        facts: Array<{
          kind: 'headline' | 'summary';
          value: string;
          sourceLocator: string;
          confidence: 'official-api';
        }>;
      };
    }
  | {
      status: 'connected';
      accessMode: 'native_session_snapshot';
      connectedAt: string;
      lastImportedAt: string;
      factCount: number;
      scopes?: never;
      accessTokenExpiresAt?: never;
      profile?: never;
    }
);

interface CoachMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface CandidateMemory {
  id: string;
  kind: 'fact' | 'preference' | 'hypothesis' | 'open-question';
  domain:
    | 'responsibility'
    | 'outcome'
    | 'skill'
    | 'preference'
    | 'constraint'
    | 'gap'
    | 'role-evidence'
    | 'other';
  statement: string;
  confidence: 'candidate-confirmed' | 'candidate-reported' | 'coach-hypothesis';
  sourceMessageIds: string[];
  sensitive: boolean;
  status: 'proposed' | 'confirmed' | 'corrected';
  createdAt?: string;
  updatedAt?: string;
}

type WorkDimension =
  | 'ambiguity'
  | 'evidence'
  | 'collaboration'
  | 'persuasion'
  | 'planning'
  | 'detail'
  | 'leadership'
  | 'craft';

type WorkPreferenceSubmission = Record<WorkDimension, number>;

interface WorkPreferenceResult {
  kind: 'work-preferences';
  version: 1;
  roleFamilies: Array<{
    id: 'product-discovery' | 'operations-program' | 'commercial-customer' | 'specialist-analysis';
    signalStrength: number;
    contributions: Array<{
      dimension: WorkDimension;
      answer: number;
      weight: number;
      contribution: number;
    }>;
  }>;
  caveat: string;
}

interface ProductCaseSubmission {
  firstMove: 'segment-funnel-and-interviews' | 'review-funnel-only' | 'ship-largest-client-request';
  priorityRule:
    'reversible-test-biggest-uncertainty' | 'revenue-weighted-request' | 'loudest-stakeholder';
  successMeasure: 'activation-by-segment-with-guardrail' | 'delivery-date' | 'features-shipped';
  rationale: string;
}

interface ProductCaseResult {
  kind: 'product-case';
  version: 1;
  rubric: Array<{
    criterion: 'problem-framing' | 'evidence-prioritisation' | 'outcome-measurement';
    selectedOption: string;
    points: number;
    maxPoints: 2;
  }>;
  demonstratedSignals: string[];
  openQuestions: string[];
  rationale: string;
  summary: string;
  caveat: string;
}

type StoredAssessment =
  | {
      assessmentId: 'work-preferences-v1';
      submission: WorkPreferenceSubmission;
      result: WorkPreferenceResult;
      completedAt: string;
      updatedAt: string;
    }
  | {
      assessmentId: 'product-case-v1';
      submission: ProductCaseSubmission;
      result: ProductCaseResult;
      completedAt: string;
      updatedAt: string;
    };

interface GermanyMarketSubmission {
  workAuthorization: 'eu-eea-swiss' | 'german-permit' | 'none' | 'unknown';
  jobOffer: 'yes' | 'no' | 'in-progress';
  grossAnnualSalaryEur: number | null;
  offerDurationMonths: number | null;
  qualification: 'recognized-comparable' | 'state-recognized-origin' | 'none' | 'unknown';
  professionRegulation:
    'regulated-authorized' | 'regulated-unresolved' | 'non-regulated' | 'unknown';
  blueCardBand: 'general' | 'reduced' | 'unknown';
  fundsMonthlyEur: number | null;
  languageEvidence: 'german-a1-plus' | 'english-b2-plus' | 'both' | 'below' | 'unknown';
  relocationReadiness: 'ready' | 'exploring' | 'not-ready';
  dependants: 'none' | 'partner' | 'children' | 'partner-and-children';
  targetWorkMode: 'onsite' | 'hybrid' | 'remote-from-germany';
}

interface StoredGermanyMarket {
  country: 'DE';
  submission: GermanyMarketSubmission;
  result: {
    packVersion: 'DE-2026.1';
    packStatus: 'current' | 'stale';
    reviewedAt: string;
    recommendedRouteId: string | null;
    routes: Array<{
      id: string;
      status: 'strong-signal' | 'possible-needs-check' | 'blocked' | 'not-applicable';
      title: string;
      summary: string;
      evidence: string[];
      missingEvidence: string[];
      threshold: { amountEur: number; cadence: 'annual' | 'monthly'; validForYear: number } | null;
      sourceIds: string[];
    }>;
    globalMissingEvidence: string[];
    constraints: string[];
    sources: Record<string, { title: string; url: string; publisher: string; reviewedAt: string }>;
    caveat: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CoachResult {
  message: string;
  phase: CoachPhase;
  nextQuestion: string | null;
  completeness: {
    known: string[];
    unknown: string[];
  };
  safety: {
    needsHuman: boolean;
    reason: string | null;
  };
  careerTrack: {
    objective: string;
    alternatives: Array<{
      label: string;
      reason: string;
      evidenceRefs: string[];
      unknowns: string[];
    }>;
    milestones: Array<{
      label: string;
      expectedSignal: string;
      measureAfter: string;
      successCriterion: string;
    }>;
  } | null;
  actionProposals: Array<{
    kind:
      | 'resume.draft'
      | 'resume.revise'
      | 'vacancies.search'
      | 'vacancies.local_query'
      | 'company.evaluate'
      | 'market.evaluate'
      | 'cover_letter.draft'
      | 'application.prepare'
      | 'application.submit'
      | 'outreach.prepare'
      | 'outreach.send'
      | 'connection.request';
    objective: string;
    evidenceRefs: string[];
    acceptanceCriteria: string[];
    expectedSignal: string;
    measureAfter: string;
    risk: 'read_only' | 'candidate_data_write' | 'external_side_effect';
  }>;
  intelligence?: {
    orchestrationRevision: string;
    roleCoverage: Array<'career_consultant' | 'career_strategist' | 'career_expert'>;
    roleContributions: Array<{
      role: 'career_consultant' | 'career_strategist' | 'career_expert';
      summary: string;
      evidenceRefs: string[];
      unknowns: string[];
      provider: string;
      model: string;
      promptRevision: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }>;
    evidenceCoverage: number;
    unsupportedClaimCount: number;
    marketEvidence?: {
      source: 'hh';
      observationCount: number;
      observedAt: string;
    } | null;
  };
}

type CareerCommandStatus =
  | 'awaiting_approval'
  | 'prepared'
  | 'queued'
  | 'executing'
  | 'completed_with_receipt'
  | 'paused'
  | 'failed'
  | 'native_handoff';

export interface CareerCommand {
  commandId: string;
  capability: CoachResult['actionProposals'][number]['kind'];
  status: CareerCommandStatus;
  proposal: CoachResult['actionProposals'][number];
  provenance?: {
    strategyDecisionId: string;
    evidenceRefs: string[];
    modelInvocationIds: string[];
  };
  execution: {
    status: 'executing' | 'completed_with_receipt' | 'paused' | 'failed' | 'native_handoff';
    updatedAt: string;
    connector: {
      id: string;
      transport:
        | 'official_api'
        | 'public_feed'
        | 'public_http_parser'
        | 'browser_session'
        | 'native_handoff';
      providerReference: string | null;
      evidenceKind: 'provider_receipt' | 'dom_confirmation' | 'candidate_confirmation' | null;
      evidenceObservedAt: string | null;
    } | null;
    diagnosticReason: string | null;
  } | null;
}

export interface CandidateSnapshot {
  candidate: {
    id: string;
    dataClass: 'synthetic' | 'personal';
    locale: 'ru-RU' | 'en-US';
    createdAt: string;
  };
  messages: CoachMessage[];
  memory: CandidateMemory[];
  turns: Array<{
    idempotencyKey: string;
    phase: CoachPhase;
    status: 'pending' | 'failed' | 'completed';
    result: CoachResult | null;
    provenance: {
      provider: string;
      model: string;
      responseId: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    } | null;
  }>;
  dossier: {
    sections: Array<{
      domain: CandidateMemory['domain'];
      items: Array<{
        memoryId: string;
        statement: string;
        status: CandidateMemory['status'];
        sourceMessageIds: string[];
        sensitive: boolean;
      }>;
    }>;
    confirmedCount: number;
    proposedCount: number;
    readiness: {
      complete: boolean;
      unresolvedQuestions: number;
      checks: Array<{
        id: 'experience' | 'impact' | 'capability' | 'direction' | 'unknowns';
        complete: boolean;
        evidenceCount: number;
      }>;
    };
  };
  assessments: StoredAssessment[];
  germanyMarket: StoredGermanyMarket | null;
  documents: CandidateDocument[];
  vacancySubscriptions: VacancySubscription[];
}

export async function getSession(): Promise<AuthUser | null> {
  const response = await apiFetch('/api/v1/auth/me');
  return readData<AuthUser | null>(response);
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await apiFetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return readDataObject<AuthUser>(response);
}

export async function register(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<AuthUser> {
  const response = await apiFetch('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<AuthUser>(response);
}

export async function logout(): Promise<void> {
  setStoredSessionToken(null);
  const response = await apiFetch('/api/v1/auth/logout', {
    method: 'POST',
  });
  if (!response.ok) {
    await throwApiError(response);
  }
}

export async function getConnections(): Promise<CandidateConnection[]> {
  const response = await apiFetch('/api/v1/candidate/connections');
  return readDataArray<CandidateConnection>(response);
}

export type DisconnectedConnection = {
  platform: 'linkedin' | 'hh';
  status: 'disconnected';
} & (
  | {
      localDataRemoved: boolean;
      upstreamRevocation: 'revoked' | 'failed' | 'unsupported';
      accessMode?: never;
    }
  | {
      accessMode: 'native_session_snapshot';
      connectionRemoved: boolean;
      providerSession: 'not_managed';
      importedData: 'retained';
      oauthCleanup?: {
        localDataRemoved: boolean;
        upstreamRevocation: 'revoked' | 'failed' | 'unsupported';
      };
      localDataRemoved?: never;
      upstreamRevocation?: never;
    }
);

export async function disconnectConnection(
  platform: 'linkedin' | 'hh',
): Promise<DisconnectedConnection> {
  const response = await apiFetch(`/api/v1/candidate/connections/${platform}`, {
    method: 'DELETE',
  });
  return readDataObject<DisconnectedConnection>(response);
}

export async function getCandidate(): Promise<CandidateSnapshot> {
  const response = await apiFetch('/api/v1/candidate/me');
  return readDataObject<CandidateSnapshot>(response);
}

export async function getAccount(): Promise<AccountSnapshot> {
  const response = await apiFetch('/api/v1/account');
  return readDataObject<AccountSnapshot>(response);
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<AuthUser> {
  const response = await apiFetch('/api/v1/account/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject<AuthUser>(response);
}

export async function requestPasswordReset(identifier: string): Promise<boolean> {
  const response = await apiFetch('/api/v1/auth/password-reset-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
  const result = await readDataObject<{ accepted: true; deliveryConfigured: boolean }>(response);
  return result.deliveryConfigured;
}

export async function resetPassword(token: string, newPassword: string): Promise<AuthUser> {
  const response = await apiFetch('/api/v1/auth/password-resets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  return readDataObject<AuthUser>(response);
}

export async function revokeOtherSessions(): Promise<number> {
  const response = await apiFetch('/api/v1/account/sessions', {
    method: 'DELETE',
  });
  return (await readDataObject<{ revoked: number }>(response)).revoked;
}

export async function uploadCandidateDocument(input: {
  kind: CandidateDocumentKind;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  extractedText?: string;
  parseStatus: CandidateDocument['parseStatus'];
  replacesDocumentId?: string;
}): Promise<{ created: boolean; document: CandidateDocument }> {
  const response = await apiFetch('/api/v1/candidate/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, source: 'upload' }),
  });
  return readDataObject(response);
}

export async function deleteCandidateDocument(documentId: string): Promise<void> {
  const response = await apiFetch(`/api/v1/candidate/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) await throwApiError(response);
}

export async function downloadCandidateDocument(documentId: string): Promise<Blob> {
  const response = await apiFetch(
    `/api/v1/candidate/documents/${encodeURIComponent(documentId)}/download`,
    { headers: { Accept: 'application/octet-stream' } },
  );
  if (!response.ok) await throwApiError(response);
  return response.blob();
}

export async function createVacancySubscription(input: {
  source: VacancySourceId;
  query: string;
  cadenceMinutes?: number;
}): Promise<VacancySubscriptionView> {
  const response = await apiFetch('/api/v1/candidate/vacancy-subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readDataObject(response);
}

export async function getVacancySources(): Promise<VacancySourceRegistryEntry[]> {
  const response = await apiFetch('/api/v1/candidate/vacancy-sources');
  return readDataArray<VacancySourceRegistryEntry>(response);
}

export async function getVacancySubscription(
  subscriptionId: string,
): Promise<VacancySubscriptionView> {
  const response = await apiFetch(
    `/api/v1/candidate/vacancy-subscriptions/${encodeURIComponent(subscriptionId)}/vacancies`,
  );
  return readDataObject(response);
}

export async function refreshVacancySubscription(
  subscriptionId: string,
): Promise<VacancySubscriptionView> {
  const response = await apiFetch(
    `/api/v1/candidate/vacancy-subscriptions/${encodeURIComponent(subscriptionId)}/refresh`,
    { method: 'POST' },
  );
  return readDataObject(response);
}

export async function updateVacancySubscription(
  subscriptionId: string,
  status: VacancySubscription['status'],
): Promise<VacancySubscription> {
  const response = await apiFetch(
    `/api/v1/candidate/vacancy-subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    },
  );
  return readDataObject(response);
}

export async function deleteVacancySubscription(subscriptionId: string): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/vacancy-subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) await throwApiError(response);
}

export async function exportCandidateData(): Promise<unknown> {
  const response = await apiFetch('/api/v1/candidate/export');
  return readData(response);
}

export async function deleteCandidateAccount(): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/me', {
    method: 'DELETE',
  });
  if (!response.ok) await throwApiError(response);
}

export async function sendCoachTurn(input: {
  content: string;
  marketQuery?: string;
  idempotencyKey?: string;
  messageId?: string;
}): Promise<CoachResult> {
  const response = await apiFetch('/api/v1/coach/turn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify({
      messageId: input.messageId ?? crypto.randomUUID(),
      content: input.content,
      marketQuery: input.marketQuery,
    }),
  });
  return readDataObject<CoachResult>(response);
}

export async function prepareCareerCommand(input: {
  turnIdempotencyKey: string;
  proposalIndex: number;
  idempotencyKey?: string;
}): Promise<CareerCommand> {
  const response = await apiFetch('/api/v1/candidate/career-commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify({
      turnIdempotencyKey: input.turnIdempotencyKey,
      proposalIndex: input.proposalIndex,
    }),
  });
  return readDataObject(response);
}

export async function approveCareerCommand(
  commandId: string,
  input: { idempotencyKey?: string } = {},
): Promise<CareerCommand> {
  const response = await apiFetch(
    `/api/v1/candidate/career-commands/${encodeURIComponent(commandId)}/approvals`,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': input.idempotencyKey ?? crypto.randomUUID(),
      },
    },
  );
  return readDataObject(response);
}

export async function getCareerCommand(commandId: string): Promise<CareerCommand> {
  const response = await apiFetch(
    `/api/v1/candidate/career-commands/${encodeURIComponent(commandId)}`,
  );
  return readDataObject(response);
}

export async function getCareerCommands(): Promise<CareerCommand[]> {
  const response = await apiFetch('/api/v1/candidate/career-commands');
  return readDataArray<CareerCommand>(response);
}

export async function changeMemory(
  memoryId: string,
  input: { action: 'confirm' | 'delete' } | { action: 'correct'; statement: string },
): Promise<void> {
  const response = await apiFetch(`/api/v1/candidate/memory/${encodeURIComponent(memoryId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await throwApiError(response);
  }
}


export async function getMatchedVacancies(signal?: AbortSignal): Promise<MatchedVacancyItem[]> {
  const response = await apiFetch('/api/v1/candidate/matched-vacancies', { signal });
  if (!response.ok) {
    await throwApiError(response);
  }
  return readDataArray<MatchedVacancyItem>(response);
}
