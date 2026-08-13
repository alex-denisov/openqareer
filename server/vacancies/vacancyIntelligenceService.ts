import type { CandidateStore } from '../data/candidateStore';
import { VacancyConnectorError } from '../connectors/vacancyConnectorError';
import type {
  StoredVacancy,
  StoredVacancySubscription,
  VacancySource,
  VacancySubscriptionInput,
  VacancySample,
} from '../domain/vacancy';

type VacancyConnector = (input: { text: string; perPage?: number }) => Promise<VacancySample>;

interface VacancyIntelligenceServiceOptions {
  store: CandidateStore;
  connectors: Partial<Record<VacancySource, VacancyConnector>>;
  maxBatchSize?: number;
  leaseMinutes?: number;
}

export class VacancyIntelligenceService {
  private readonly store: CandidateStore;
  private readonly connectors: Partial<Record<VacancySource, VacancyConnector>>;
  private readonly maxBatchSize: number;
  private readonly leaseMinutes: number;

  constructor(options: VacancyIntelligenceServiceOptions) {
    this.store = options.store;
    this.connectors = options.connectors;
    this.maxBatchSize = Math.max(1, Math.min(20, Math.trunc(options.maxBatchSize ?? 5)));
    this.leaseMinutes = Math.max(1, Math.min(30, Math.trunc(options.leaseMinutes ?? 2)));
  }

  async createAndRefresh(
    candidateId: string,
    input: VacancySubscriptionInput,
    now: string = new Date().toISOString(),
  ): Promise<{
    subscription: StoredVacancySubscription;
    vacancies: StoredVacancy[];
  }> {
    const created = this.store.createVacancySubscription(candidateId, input, now);
    await this.refreshCandidateSubscription(candidateId, created.id, now);
    return this.subscriptionView(candidateId, created.id);
  }

  async refreshCandidateSubscription(
    candidateId: string,
    subscriptionId: string,
    attemptedAt: string = new Date().toISOString(),
  ): Promise<{
    subscription: StoredVacancySubscription;
    vacancies: StoredVacancy[];
  }> {
    const subscription = this.store.getVacancySubscription(candidateId, subscriptionId);
    if (!subscription) throw new VacancySubscriptionAccessError();
    try {
      const sample = await this.connector(subscription.source)({
        text: subscription.query,
        perPage: 20,
      });
      this.store.recordVacancyRefresh(subscription.id, sample);
    } catch (error) {
      this.store.recordVacancyFailure(
        subscription.id,
        vacancyErrorCode(error),
        attemptedAt,
        retryAfterAt(error),
      );
    }
    return this.subscriptionView(candidateId, subscriptionId);
  }

  async runDue(
    nowInput: string = new Date().toISOString(),
  ): Promise<{ claimed: number; succeeded: number; failed: number }> {
    const now = new Date(nowInput);
    if (Number.isNaN(now.getTime())) throw new Error('invalid scheduler time');
    const leaseUntil = new Date(now.getTime() + this.leaseMinutes * 60 * 1_000).toISOString();
    const claimed = this.store.claimDueVacancySubscriptions(
      now.toISOString(),
      leaseUntil,
      this.maxBatchSize,
    );
    let succeeded = 0;
    let failed = 0;
    for (const subscription of claimed) {
      try {
        const sample = await this.connector(subscription.source)({
          text: subscription.query,
          perPage: 20,
        });
        this.store.recordVacancyRefresh(subscription.id, sample);
        succeeded += 1;
      } catch (error) {
        this.store.recordVacancyFailure(
          subscription.id,
          vacancyErrorCode(error),
          now.toISOString(),
          retryAfterAt(error),
        );
        failed += 1;
      }
    }
    return {
      claimed: claimed.length,
      succeeded,
      failed,
    };
  }

  private subscriptionView(candidateId: string, subscriptionId: string) {
    const subscription = this.store.getVacancySubscription(candidateId, subscriptionId);
    if (!subscription) throw new VacancySubscriptionAccessError();
    return {
      subscription,
      vacancies: this.store.listSubscriptionVacancies(candidateId, subscriptionId),
    };
  }

  private connector(source: VacancySource): VacancyConnector {
    const connector = this.connectors[source];
    if (!connector) throw new Error(`${source}_vacancy_search_unavailable`);
    return connector;
  }
}

export class VacancySubscriptionAccessError extends Error {}

function vacancyErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('official_access_required')) {
    return 'official_access_required';
  }
  if (message.includes('rate_limited')) return 'source_rate_limited';
  if (message.includes('challenge')) return 'source_challenge';
  if (message.includes('invalid')) return 'source_response_invalid';
  return 'source_unavailable';
}

function retryAfterAt(error: unknown): string | undefined {
  return error instanceof VacancyConnectorError ? error.retryAfterAt : undefined;
}
