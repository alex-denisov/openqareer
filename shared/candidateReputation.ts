export type ReputationOverallStatus = 'safe' | 'attention' | 'critical_risk';
export type ReputationAuditStatus = 'pending' | 'completed' | 'failed';

export interface ConsistencyDiscrepancy {
  id: string;
  field: string;
  candidateValue: string;
  externalValue: string;
  externalSource: string;
  severity: 'warning' | 'critical';
  suggestion: string;
}

export interface ReputationRiskItem {
  id: string;
  sourceUrl?: string;
  sourcePlatform: string;
  publishedAt?: string;
  excerpt: string;
  category: 'toxic_workplace' | 'nda_leak' | 'compliance_conflict' | 'polarizing_argument';
  severity: 'low' | 'medium' | 'high';
  remediation: string;
}

export interface CandidateReputationAudit {
  id: string;
  candidateId: string;
  status: ReputationAuditStatus;
  overallStatus: ReputationOverallStatus;
  score: number;
  consistencyDiscrepancies: ConsistencyDiscrepancy[];
  reputationRisks: ReputationRiskItem[];
  consentAction: string;
  startedAt: string;
  completedAt?: string;
}

export interface StartReputationAuditResponse {
  audit: CandidateReputationAudit;
}

export interface GetReputationAuditResponse {
  audit: CandidateReputationAudit | null;
}
