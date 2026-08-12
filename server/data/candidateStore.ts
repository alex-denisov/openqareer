import type {
  CoachMessage,
  CoachPhase,
  CoachTurnResult,
  MemoryCandidate,
} from '../domain/coach';
import type { ExperienceDossier } from '../domain/dossier';
import type {
  GermanyMarketResult,
  GermanyMarketSubmission,
} from '../domain/germanyMarket';
import type {
  AssessmentId,
  AssessmentResult,
  AssessmentSubmission,
} from '../domain/assessment';
import type { CoachProviderResult } from '../providers/coachProvider';
import type { OAuthPlatform } from '../connectors/oauthTypes';
import type { ConnectorActionRecord } from '../connectors/connectorActionQueue';
import type {
  CareerCommandRecord,
  VerifiedCareerApproval,
} from '../orchestration/careerCommandPlanner';

export interface CandidateIdentity {
  id: string;
  dataClass: 'synthetic' | 'personal';
  locale: 'ru-RU' | 'en-US';
  createdAt: string;
}

export interface CandidateCredentials extends CandidateIdentity {
  accessToken: string;
}

export interface CandidateSnapshot {
  candidate: CandidateIdentity;
  messages: CoachMessage[];
  memory: StoredMemory[];
  turns: StoredTurn[];
  dossier: ExperienceDossier;
  assessments: StoredAssessment[];
  germanyMarket: StoredGermanyMarket | null;
}

export interface StoredGermanyMarket {
  country: 'DE';
  submission: GermanyMarketSubmission;
  result: GermanyMarketResult;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAssessment {
  assessmentId: AssessmentId;
  submission: AssessmentSubmission;
  result: AssessmentResult;
  completedAt: string;
  updatedAt: string;
}

export interface StoredMemory extends MemoryCandidate {
  id: string;
  status: 'proposed' | 'confirmed' | 'corrected';
  createdAt: string;
  updatedAt: string;
}

export interface StoredTurn {
  idempotencyKey: string;
  phase: CoachPhase;
  status: 'pending' | 'failed' | 'completed';
  result: CoachTurnResult | null;
  provenance: {
    provider: CoachProviderResult['provider'];
    model: string;
    responseId: string;
    usage: CoachProviderResult['usage'];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnRequest {
  messageId: string;
  content: string;
  marketQuery?: string;
  phase: CoachPhase;
}

export type StartedTurn =
  | {
      state: 'ready';
      input: {
        candidateReference: string;
        dataClass: CandidateIdentity['dataClass'];
        locale: CandidateIdentity['locale'];
        phase: CoachPhase;
        messages: CoachMessage[];
      };
    }
  | {
      state: 'completed';
      output: CoachProviderResult;
    };

export interface MemoryChange {
  action: 'confirm' | 'correct' | 'delete';
  statement?: string;
}

export interface OAuthAuthorizationInput {
  platform: OAuthPlatform;
  stateDigest: string;
  codeVerifier: string;
  expiresAt: string;
}

export interface ConsumedOAuthAuthorization {
  candidateId: string;
  codeVerifier: string;
}

export type OAuthCapability =
  | 'lite_identity'
  | 'profile_read'
  | 'resume_read';

export interface OAuthProfileFact {
  kind: 'headline' | 'summary';
  value: string;
  sourceLocator: string;
  confidence: 'official-api';
}

export interface OAuthConnectionInput {
  platform: OAuthPlatform;
  externalAccountId: string;
  scopes: string[];
  capabilities: ReadonlyArray<OAuthCapability>;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  profile: {
    capturedAt: string;
    sourceUrl: string | null;
    facts: OAuthProfileFact[];
  };
}

export interface StoredOAuthConnection extends OAuthConnectionInput {
  connectedAt: string;
  updatedAt: string;
}

export interface CandidateStore {
  createCandidate(input: {
    dataClass: CandidateIdentity['dataClass'];
    locale: CandidateIdentity['locale'];
  }): CandidateCredentials;
  authenticate(accessToken: string): CandidateIdentity | null;
  startTurn(
    candidateId: string,
    idempotencyKey: string,
    request: TurnRequest,
  ): StartedTurn;
  completeTurn(
    candidateId: string,
    idempotencyKey: string,
    output: CoachProviderResult,
  ): void;
  failTurn(
    candidateId: string,
    idempotencyKey: string,
    errorCode: string,
  ): void;
  getSnapshot(candidateId: string): CandidateSnapshot;
  changeMemory(
    candidateId: string,
    memoryId: string,
    change: MemoryChange,
  ): StoredMemory | null;
  saveAssessment(
    candidateId: string,
    assessmentId: AssessmentId,
    submission: AssessmentSubmission,
    result: AssessmentResult,
  ): StoredAssessment;
  saveGermanyMarket(
    candidateId: string,
    submission: GermanyMarketSubmission,
    result: GermanyMarketResult,
  ): StoredGermanyMarket;
  createOAuthAuthorization(
    candidateId: string,
    authorization: OAuthAuthorizationInput,
  ): void;
  consumeOAuthAuthorization(
    platform: OAuthPlatform,
    stateDigest: string,
    consumedAt: string,
  ): ConsumedOAuthAuthorization | null;
  saveOAuthConnection(
    candidateId: string,
    connection: OAuthConnectionInput,
  ): StoredOAuthConnection;
  getOAuthConnection(
    candidateId: string,
    platform: OAuthPlatform,
  ): StoredOAuthConnection | null;
  listOAuthConnections(candidateId: string): StoredOAuthConnection[];
  deleteOAuthConnection(
    candidateId: string,
    platform: OAuthPlatform,
  ): boolean;
  saveCareerCommand(command: CareerCommandRecord): CareerCommandRecord;
  getCareerCommand(
    candidateId: string,
    commandId: string,
  ): CareerCommandRecord | null;
  listCareerCommands(candidateId: string): CareerCommandRecord[];
  approveCareerCommand(input: {
    candidateId: string;
    commandId: string;
    approval: VerifiedCareerApproval;
    consumedAt: string;
  }): CareerCommandRecord;
  claimCareerCommand(
    candidateId: string,
    commandId: string,
    execution: ConnectorActionRecord,
    claimedAt: string,
  ): CareerCommandRecord;
  finishCareerCommand(
    candidateId: string,
    commandId: string,
    command: CareerCommandRecord,
  ): CareerCommandRecord;
  exportCandidate(candidateId: string): CandidateSnapshot;
  deleteCandidate(candidateId: string): boolean;
  close(): void;
}
