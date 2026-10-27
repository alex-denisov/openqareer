import { describe, expect, it } from 'vitest';
import { emptyVacancyMechanicsStats, formatVacancyMechanicsStats } from './vacancyMechanicsStats';

describe('vacancy mechanics batch journal line', () => {
  it('names the reserve lane and why OpenRouter was skipped', () => {
    const line = formatVacancyMechanicsStats(
      {
        ...emptyVacancyMechanicsStats(),
        requirementsDone: 1,
        llmCalls: 1,
        llmMs: 10,
        lastModel: 'gemini-3.8-flash',
        providers: ['gemini'],
        fallbackCalls: 1,
        fallbackReason: 'openrouter_402',
      },
      60_000,
    );
    expect(line).toContain('fallback=gemini reason=openrouter_402 fallback_calls=1');
  });
  it('stays silent for an idle batch', () => {
    expect(formatVacancyMechanicsStats(emptyVacancyMechanicsStats(), 60_000)).toBeNull();
  });
  it('names counts and the failure class in one line', () => {
    const line = formatVacancyMechanicsStats(
      {
        ...emptyVacancyMechanicsStats(),
        requirementsDone: 2,
        claimed: 5,
        completed: 3,
        deferred: 1,
        failed: 1,
        lastError: 'requirements_wait_timeout',
      },
      61_000,
    );
    expect(line).toBe(
      'vacancy-mechanics batch 61s: requirements=2 fit_claimed=5 completed=3 deferred=1 retried=0 failed=1 last_error=requirements_wait_timeout',
    );
  });
});

describe('model part of the batch journal line (B522)', () => {
  it('names model, providers, average latency and the failed extraction share', () => {
    const line = formatVacancyMechanicsStats(
      {
        ...emptyVacancyMechanicsStats(),
        requirementsDone: 9,
        requirementsInvalid: 1,
        llmCalls: 10,
        llmFailed: 0,
        llmMs: 101_000,
        lastModel: 'deepseek/deepseek-v4-flash',
        providers: ['StreamLake', 'DeepInfra'],
      },
      60_000,
    );
    expect(line).toContain(
      '| model=deepseek/deepseek-v4-flash providers=StreamLake,DeepInfra llm_calls=10 llm_failed=0 llm_avg_ms=10100 extract_unavailable=0 extract_invalid=1 extract_failed_share=10%',
    );
  });
  it('counts why model answers and entries were not used (B510-r)', () => {
    const line = formatVacancyMechanicsStats(
      {
        ...emptyVacancyMechanicsStats(),
        requirementsDone: 3,
        requirementsInvalid: 1,
        llmCalls: 4,
        llmMs: 4_000,
        modelIssues: { long_label: 3, no_valid_entries: 1, quote: 2 },
      },
      60_000,
    );
    expect(line).toMatch(
      /extract_failed_share=25% extract_issues=long_label:3,no_valid_entries:1,quote:2$/u,
    );
  });
});
