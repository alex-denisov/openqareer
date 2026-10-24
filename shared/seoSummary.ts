/** Counts remaining personal records, excluding synthetic candidates. No visitor attribution. */
export interface SeoGoalSummary {
  observedAt: string;
  period: { from: string; to: string; days: number };
  source: 'internal_operational_records';
  goals: {
    onboardingCompleted: number;
    proTrialsStarted: number | null;
    applicationsWithCandidateReceipt: number;
  };
  methodology: {
    onboarding: 'explicit_wizard_completion_since_instrumentation';
    trials: 'committed_trial_rows';
    applications: 'candidate_provided_positive_receipt_since_instrumentation';
    deletedCandidates: 'excluded';
    syntheticCandidates: 'excluded';
    organicConversion: 'unavailable_no_attribution';
  };
  searchProviders: import('./seoSourceSnapshot').SeoSearchProviders;
}
