import type {
  CandidateAnalysis,
} from '../evidence/evidenceEngine';
import type {
  OpportunityRecord,
} from '../opportunity/opportunityEngine';
import type { ActionPackage } from '../action/actionPackageEngine';
import type { OutcomeEvent } from '../outcome/outcomeEngine';
import type { ProfileFact } from './profileIngestion';

export const WORKSPACE_STORAGE_KEY = 'candidate-workspace';
export const WORKSPACE_OWNER_KEY = 'candidate-workspace-owner';
export const WORKSPACE_VERSION = 6;

export type WorkspaceMarket = 'ru' | 'international';
export type ResumeSource = 'pdf' | 'linkedin-pdf' | 'hh-pdf' | 'text';
export type SearchUrgency = 'exploring' | 'active' | 'urgent';
export type CareerGoal = 'find-job' | 'choose-role' | 'positioning' | 'market';

export interface WorkspaceInput {
  careerGoal?: CareerGoal;
  resumeText: string;
  resumeSource: ResumeSource;
  resumeFileName?: string;
  resumePageCount?: number;
  targetDirection: string;
  market: WorkspaceMarket;
  currentSituation: string;
  constraints: string;
  urgency: SearchUrgency;
  linkedinUrl?: string;
  hhUrl?: string;
  profileFacts?: ProfileFact[];
  resumeDraft?: import('../resume/resumeTypes').ResumeDraft;
  parsedResume?: import('./resumeParser').ParsedResume;
  /**
   * True once the document has already reached the candidate-scoped resume API.
   * Without it a signed-in wizard would import the same document twice — once
   * at upload, once on completion (B148).
   */
  resumeImported?: boolean;
}

interface MarketVacancySampleItem {
  id: string;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  publishedAt: string | null;
  salary: {
    from: number | null;
    to: number | null;
    currency: string;
    gross: boolean;
  } | null;
}

export interface MarketVacancySample {
  source: 'hh';
  query: string;
  found: number;
  fetchedAt: string;
  items: MarketVacancySampleItem[];
}

export interface CandidateWorkspace extends WorkspaceInput {
  version: typeof WORKSPACE_VERSION;
  createdAt: string;
  updatedAt: string;
  analysis?: CandidateAnalysis;
  marketSample?: MarketVacancySample;
  opportunity?: OpportunityRecord;
  actionPackage?: ActionPackage;
  outcomes: OutcomeEvent[];
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export type WorkspaceLoadResult =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'ready'; workspace: CandidateWorkspace };

export type WorkspaceInputErrors = Partial<
  Record<keyof WorkspaceInput, string>
>;

