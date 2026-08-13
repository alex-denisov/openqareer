import type {
  CoachMessage,
  CoachPhase,
  CoachTurnInput,
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
import type { HhVacancySample } from '../connectors/hhVacancySearch';
import type {
  StoredVacancy,
  StoredVacancySubscription,
  ClaimedVacancySubscription,
  VacancyRefreshResult,
  VacancySubscriptionInput,
} from '../domain/vacancy';

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
  documents: StoredCandidateDocument[];
  vacancySubscriptions: StoredVacancySubscription[];
}

export interface CandidateExport extends CandidateSnapshot {
  documentContents: CandidateDocumentWithContent[];
}

export type CandidateDocumentKind =
  | 'resume'
  | 'cover_letter'
  | 'certificate'
  | 'portfolio'
  | 'profile_export'
  | 'other';

export interface CandidateDocumentInput {
  kind: CandidateDocumentKind;
  source: 'upload' | 'generated' | 'import';
  fileName: string;
  mimeType: string;
  contentBase64: string;
  extractedText?: string;
  parseStatus: 'pending' | 'ready' | 'failed' | 'not_applicable';
  replacesDocumentId?: string;
}

export interface StoredCandidateDocument {
  id: string;
  familyId: string;
  version: number;
  kind: CandidateDocumentKind;
  source: CandidateDocumentInput['source'];
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  parseStatus: CandidateDocumentInput['parseStatus'];
  retentionUntil: string | null;
  supersedesDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateDocumentWithContent extends StoredCandidateDocument {
  contentBase64: string;
  extractedText: string | null;
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
        knowledgeContext: NonNullable<CoachTurnInput['knowledgeContext']>;
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
  saveDocument(
    candidateId: string,
    input: CandidateDocumentInput,
  ): { created: boolean; document: StoredCandidateDocument };
  getDocument(
    candidateId: string,
    documentId: string,
  ): CandidateDocumentWithContent | null;
  deleteDocument(candidateId: string, documentId: string): boolean;
  setDocumentRetention(
    candidateId: string,
    documentId: string,
    retentionUntil: string | null,
    now: string,
  ): StoredCandidateDocument | null;
  purgeExpiredDocuments(now: string, limit: number): number;
  createVacancySubscription(
    candidateId: string,
    input: VacancySubscriptionInput,
    now: string,
  ): StoredVacancySubscription;
  listVacancySubscriptions(candidateId: string): StoredVacancySubscription[];
  getVacancySubscription(
    candidateId: string,
    subscriptionId: string,
  ): StoredVacancySubscription | null;
  recordVacancyRefresh(
    subscriptionId: string,
    sample: HhVacancySample,
  ): VacancyRefreshResult;
  listSubscriptionVacancies(
    candidateId: string,
    subscriptionId: string,
  ): StoredVacancy[];
  claimDueVacancySubscriptions(
    now: string,
    leaseUntil: string,
    limit: number,
  ): ClaimedVacancySubscription[];
  recordVacancyFailure(
    subscriptionId: string,
    errorCode: string,
    attemptedAt: string,
    retryAfterAt?: string,
  ): void;
  setVacancySubscriptionStatus(
    candidateId: string,
    subscriptionId: string,
    status: StoredVacancySubscription['status'],
    now: string,
  ): StoredVacancySubscription | null;
  deleteVacancySubscription(
    candidateId: string,
    subscriptionId: string,
  ): boolean;
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
  exportCandidate(candidateId: string): CandidateExport;
  deleteCandidate(candidateId: string): boolean;
  close(): void;
}
