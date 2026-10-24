import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SeoGoalSummary } from '../../../shared/seoSummary';
import { AdminSeoSummaryData } from './AdminSeoSummaryView';

const summary: SeoGoalSummary = {
  observedAt: '2026-10-24T03:00:00Z', period: { from: '2026-09-26T03:00:00Z', to: '2026-10-24T03:00:00Z', days: 28 },
  source: 'internal_operational_records',
  goals: { onboardingCompleted: 0, proTrialsStarted: null, applicationsWithCandidateReceipt: 2 },
  methodology: { onboarding: 'explicit_wizard_completion_since_instrumentation', trials: 'committed_trial_rows',
    applications: 'candidate_provided_positive_receipt_since_instrumentation', deletedCandidates: 'excluded',
    syntheticCandidates: 'excluded', organicConversion: 'unavailable_no_attribution' },
  searchProviders: { google: { status: 'unavailable' }, yandex: { status: 'unavailable' } },
};

describe('SEO goal summary copy', () => {
  it('keeps a measured zero distinct from a missing trial source and labels candidate receipts', () => {
    const html = renderToStaticMarkup(<AdminSeoSummaryData summary={summary} />);
    expect(html).toContain('<strong>0</strong> — завершили мастер настройки');
    expect(html).toContain('<strong>Недоступно</strong> — запустили пробную подписку Pro');
    expect(html).toContain('Квитанцию');
    expect(html).toContain('не независимая проверка работодателем');
    expect(html).toContain('Конверсия из органического поиска недоступна');
  });
});
