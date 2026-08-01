export type UserRole = 'candidate' | 'admin';
export type CoachPhase =
  | 'discovery'
  | 'evidence'
  | 'role'
  | 'market'
  | 'resume'
  | 'targeting';

export interface AuthUser {
  username: string;
  role: UserRole;
  isTest: boolean;
  candidateId: string | null;
}

export interface CoachMessage {
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
  confidence:
    | 'candidate-confirmed'
    | 'candidate-reported'
    | 'coach-hypothesis';
  sourceMessageIds: string[];
  sensitive: boolean;
  status: 'proposed' | 'confirmed' | 'corrected';
}

export type WorkDimension =
  | 'ambiguity'
  | 'evidence'
  | 'collaboration'
  | 'persuasion'
  | 'planning'
  | 'detail'
  | 'leadership'
  | 'craft';

export type WorkPreferenceSubmission = Record<WorkDimension, number>;

export interface WorkPreferenceResult {
  kind: 'work-preferences';
  version: 1;
  roleFamilies: Array<{
    id:
      | 'product-discovery'
      | 'operations-program'
      | 'commercial-customer'
      | 'specialist-analysis';
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

export interface ProductCaseSubmission {
  firstMove:
    | 'segment-funnel-and-interviews'
    | 'review-funnel-only'
    | 'ship-largest-client-request';
  priorityRule:
    | 'reversible-test-biggest-uncertainty'
    | 'revenue-weighted-request'
    | 'loudest-stakeholder';
  successMeasure:
    | 'activation-by-segment-with-guardrail'
    | 'delivery-date'
    | 'features-shipped';
  rationale: string;
}

export interface ProductCaseResult {
  kind: 'product-case';
  version: 1;
  rubric: Array<{
    criterion:
      | 'problem-framing'
      | 'evidence-prioritisation'
      | 'outcome-measurement';
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

export type StoredAssessment =
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

export interface GermanyMarketSubmission {
  workAuthorization: 'eu-eea-swiss' | 'german-permit' | 'none' | 'unknown';
  jobOffer: 'yes' | 'no' | 'in-progress';
  grossAnnualSalaryEur: number | null;
  offerDurationMonths: number | null;
  qualification: 'recognized-comparable' | 'state-recognized-origin' | 'none' | 'unknown';
  professionRegulation: 'regulated-authorized' | 'regulated-unresolved' | 'non-regulated' | 'unknown';
  blueCardBand: 'general' | 'reduced' | 'unknown';
  fundsMonthlyEur: number | null;
  languageEvidence: 'german-a1-plus' | 'english-b2-plus' | 'both' | 'below' | 'unknown';
  relocationReadiness: 'ready' | 'exploring' | 'not-ready';
  dependants: 'none' | 'partner' | 'children' | 'partner-and-children';
  targetWorkMode: 'onsite' | 'hybrid' | 'remote-from-germany';
}

export interface StoredGermanyMarket {
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
      provider: 'openai' | 'openrouter';
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
}

interface ApiEnvelope<T> {
  data: T;
}

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
}

export class CoachApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'CoachApiError';
  }
}

export async function getSession(): Promise<AuthUser | null> {
  const response = await apiFetch('/api/v1/auth/me');
  return readData<AuthUser | null>(response);
}

export async function login(
  username: string,
  password: string,
): Promise<AuthUser> {
  const response = await apiFetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return readData<AuthUser>(response);
}

export async function logout(): Promise<void> {
  const response = await apiFetch('/api/v1/auth/logout', {
    method: 'POST',
  });
  if (!response.ok) {
    await throwApiError(response);
  }
}

export async function getCandidate(): Promise<CandidateSnapshot> {
  const response = await apiFetch('/api/v1/candidate/me');
  return readData<CandidateSnapshot>(response);
}

export async function sendCoachTurn(input: {
  content: string;
  phase: CoachPhase;
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
      phase: input.phase,
    }),
  });
  return readData<CoachResult>(response);
}

export async function changeMemory(
  memoryId: string,
  input:
    | { action: 'confirm' | 'delete' }
    | { action: 'correct'; statement: string },
): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/memory/${encodeURIComponent(memoryId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    await throwApiError(response);
  }
}

export async function submitAssessment(
  assessmentId: 'work-preferences-v1',
  input: WorkPreferenceSubmission,
): Promise<StoredAssessment>;
export async function submitAssessment(
  assessmentId: 'product-case-v1',
  input: ProductCaseSubmission,
): Promise<StoredAssessment>;
export async function submitAssessment(
  assessmentId: StoredAssessment['assessmentId'],
  input: WorkPreferenceSubmission | ProductCaseSubmission,
): Promise<StoredAssessment> {
  const response = await apiFetch(
    `/api/v1/candidate/assessments/${assessmentId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return readData<StoredAssessment>(response);
}

export async function saveGermanyMarket(
  input: GermanyMarketSubmission,
): Promise<StoredGermanyMarket> {
  const response = await apiFetch('/api/v1/candidate/markets/DE', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readData<StoredGermanyMarket>(response);
}

export async function getProviderStatus(): Promise<{
  personalDataRoute: { provider: string; model: string };
  syntheticDataRoute: {
    provider: string;
    model: string;
    fallbackModels?: string[];
    outputValidation?: string;
  };
  ready: boolean;
}> {
  const response = await apiFetch('/api/v1/provider/status');
  return readData(response);
}

async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new CoachApiError(
      'Не удалось связаться с сервисом. Проверьте соединение и повторите.',
      'network_error',
      true,
    );
  }
}

async function readData<T>(response: Response): Promise<T> {
  if (!response.ok) {
    await throwApiError(response);
  }
  const envelope = (await response.json()) as ApiEnvelope<T>;
  return envelope.data;
}

async function throwApiError(response: Response): Promise<never> {
  let envelope: ApiErrorEnvelope = {};
  try {
    envelope = (await response.json()) as ApiErrorEnvelope;
  } catch {
    // The stable fallback below intentionally ignores untrusted response text.
  }
  throw new CoachApiError(
    envelope.error?.message ??
      'Сервис не завершил действие. Попробуйте ещё раз.',
    envelope.error?.code ?? `http_${response.status}`,
    envelope.error?.retryable ?? response.status >= 500,
  );
}
