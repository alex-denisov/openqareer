import type { FootprintFinding } from '../server/osint/adapters/footprintAdapter';

export type FootprintAdapterId = 'sherlock' | 'maigret' | 'hibp' | 'wayback' | 'exa';
export type FootprintReview = 'unreviewed' | 'confirmed_self' | 'not_self' | 'hidden';
export type FootprintAdapterState = 'not_run' | 'pending' | 'checked' | 'not_connected' | 'source_error';
export type CandidateFootprintAuditState = 'pending' | 'completed' | 'failed';

export interface CandidateFootprintFinding extends FootprintFinding {
  readonly id: string;
  readonly sources: readonly string[];
  readonly receipts: readonly FootprintFinding['receipt'][];
  readonly automatedMatch: 'likely_self' | 'unknown';
  readonly review: FootprintReview;
}

export interface CandidateFootprintAdapterStatus {
  readonly adapterId: FootprintAdapterId;
  readonly state: FootprintAdapterState;
  readonly sourcesChecked: number;
  readonly findingsCount: number;
  readonly checkedAt?: string;
}

export interface CandidateFootprintAudit {
  readonly id: string;
  readonly candidateId: string;
  readonly state: CandidateFootprintAuditState;
  readonly selectedQueryIds: readonly string[];
  readonly adapterStatuses: readonly CandidateFootprintAdapterStatus[];
  readonly findings: readonly CandidateFootprintFinding[];
  readonly ownershipConfirmedAt: string;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface CandidateFootprintConsentState {
  readonly approved: boolean;
  readonly granted: boolean;
  readonly versionId: string;
}

export type SourceCapabilityStatus = 'available' | 'prepared' | 'future';

export interface FootprintAdapterRegistryItem {
  readonly id: string;
  readonly title: string;
  readonly status: SourceCapabilityStatus;
  readonly description?: string;
}

export const FOOTPRINT_ADAPTER_REGISTRY: readonly FootprintAdapterRegistryItem[] = [
  {
    id: 'documentMetadata',
    title: 'Метаданные файлов',
    status: 'prepared',
    description: 'Извлечение автора, компании и путей из PDF, DOCX и JPEG',
  },
  {
    id: 'githubSecrets',
    title: 'Секреты в коде',
    status: 'prepared',
    description: 'Поиск открытых ключей API, AWS, GitHub и Slack в репозиториях',
  },
] as const;
