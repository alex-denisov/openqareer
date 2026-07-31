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

export async function getProviderStatus(): Promise<{
  personalDataRoute: { provider: string; model: string };
  syntheticDataRoute: { provider: string; model: string };
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
