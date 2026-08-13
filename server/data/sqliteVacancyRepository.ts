import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { HhVacancySample } from '../connectors/hhVacancySearch';
import {
  vacancySubscriptionInputSchema,
  type ClaimedVacancySubscription,
  type StoredVacancy,
  type StoredVacancySubscription,
  type VacancyAnalytics,
  type VacancyRefreshResult,
  type VacancySubscriptionInput,
} from '../domain/vacancy';
import type { SealedText } from './sealedText';

interface SubscriptionRow {
  id: string;
  candidate_id: string;
  source: 'hh';
  query_cipher: string;
  cadence_minutes: number;
  status: StoredVacancySubscription['status'];
  next_run_at: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  source_found: number | null;
  created_at: string;
  updated_at: string;
}

interface VacancyRow {
  id: string;
  source: 'hh';
  external_id: string;
  canonical_url: string;
  first_seen_at: string;
  last_seen_at: string;
  latest_version: number;
  content_hash: string;
  snapshot_json: string;
}

type VacancySnapshot = HhVacancySample['items'][number];

export class SqliteVacancyRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  create(
    candidateId: string,
    input: VacancySubscriptionInput,
    now: string,
  ): StoredVacancySubscription {
    const value = vacancySubscriptionInputSchema.parse(input);
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO vacancy_subscriptions
          (id, candidate_id, source, query_cipher, cadence_minutes, status,
           next_run_at, last_attempt_at, last_success_at, last_error_code,
           lease_until, source_found, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        candidateId,
        value.source,
        this.sealedText.seal(
          value.query,
          subscriptionAssociatedData(candidateId, id),
        ),
        value.cadenceMinutes,
        now,
        now,
        now,
      );
    const stored = this.get(candidateId, id);
    if (!stored) throw new Error('vacancy subscription was not persisted');
    return stored;
  }

  list(candidateId: string): StoredVacancySubscription[] {
    return this.subscriptionRows(candidateId).map((row) =>
      this.subscriptionFromRow(row),
    );
  }

  get(
    candidateId: string,
    subscriptionId: string,
  ): StoredVacancySubscription | null {
    const row = this.find(candidateId, subscriptionId);
    return row ? this.subscriptionFromRow(row) : null;
  }

  recordRefresh(
    subscriptionId: string,
    sample: HhVacancySample,
  ): VacancyRefreshResult {
    const subscription = this.findInternal(subscriptionId);
    if (!subscription) throw new VacancySubscriptionNotFoundError();
    const query = this.openQuery(subscription);
    if (subscription.source !== sample.source || query !== sample.query.trim()) {
      throw new VacancyRefreshConflictError();
    }
    const observedAt = new Date(sample.fetchedAt);
    if (Number.isNaN(observedAt.getTime())) {
      throw new VacancyRefreshConflictError();
    }
    const nextRunAt = new Date(
      observedAt.getTime() + subscription.cadence_minutes * 60 * 1_000,
    ).toISOString();
    const counts = this.persistRefresh(subscriptionId, sample, nextRunAt);
    return {
      subscriptionId,
      ...counts,
      fetchedAt: sample.fetchedAt,
      nextRunAt,
    };
  }

  private persistRefresh(
    subscriptionId: string,
    sample: HhVacancySample,
    nextRunAt: string,
  ): { created: number; updated: number; unchanged: number } {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const counts = this.linkSampleItems(subscriptionId, sample);
      this.recordSubscriptionSuccess(subscriptionId, sample, nextRunAt);
      this.recordSourceSuccess(sample);
      this.database.exec('COMMIT');
      return counts;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listVacancies(
    candidateId: string,
    subscriptionId: string,
  ): StoredVacancy[] {
    if (!this.find(candidateId, subscriptionId)) return [];
    const rows = this.database
      .prepare(
        `${VACANCY_SELECT}
         JOIN vacancy_subscription_items AS links ON links.vacancy_id = vacancies.id
         WHERE links.subscription_id = ?
         ORDER BY vacancies.last_seen_at DESC, vacancies.id`,
      )
      .all(subscriptionId) as unknown as VacancyRow[];
    return rows.map(vacancyFromRow);
  }

  claimDue(
    now: string,
    leaseUntil: string,
    limit: number,
  ): ClaimedVacancySubscription[] {
    const boundedLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const rows = this.database
        .prepare(
          `${SUBSCRIPTION_SELECT}
           WHERE status = 'active' AND next_run_at <= ?
             AND (lease_until IS NULL OR lease_until <= ?)
           ORDER BY next_run_at, id
           LIMIT ?`,
        )
        .all(now, now, boundedLimit) as unknown as SubscriptionRow[];
      const claimed = rows.flatMap((row) => {
        const result = this.database
          .prepare(
            `UPDATE vacancy_subscriptions
             SET lease_until = ?, last_attempt_at = ?, updated_at = ?
             WHERE id = ? AND status = 'active'
               AND (lease_until IS NULL OR lease_until <= ?)`,
          )
          .run(leaseUntil, now, now, row.id, now);
        return result.changes === 1
          ? [
              {
                ...this.subscriptionFromRow({
                  ...row,
                  last_attempt_at: now,
                  updated_at: now,
                }),
                candidateId: row.candidate_id,
              },
            ]
          : [];
      });
      this.database.exec('COMMIT');
      return claimed;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  recordFailure(
    subscriptionId: string,
    errorCode: string,
    attemptedAt: string,
    retryAfterAt?: string,
  ): void {
    const subscription = this.findInternal(subscriptionId);
    if (!subscription) throw new VacancySubscriptionNotFoundError();
    const attempted = new Date(attemptedAt);
    if (Number.isNaN(attempted.getTime())) {
      throw new VacancyRefreshConflictError();
    }
    const nextRunAt =
      retryAfterAt ??
      new Date(attempted.getTime() + 60 * 60 * 1_000).toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.recordSubscriptionFailure(
        subscriptionId,
        errorCode,
        attemptedAt,
        nextRunAt,
      );
      this.recordSourceFailure(
        subscription.source,
        errorCode,
        attemptedAt,
        retryAfterAt,
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  setStatus(
    candidateId: string,
    subscriptionId: string,
    status: StoredVacancySubscription['status'],
    now: string,
  ): StoredVacancySubscription | null {
    const existing = this.find(candidateId, subscriptionId);
    if (!existing) return null;
    const nextRunAt =
      status === 'active' && existing.next_run_at < now
        ? now
        : existing.next_run_at;
    this.database
      .prepare(
        `UPDATE vacancy_subscriptions
         SET status = ?, next_run_at = ?, lease_until = NULL, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(status, nextRunAt, now, candidateId, subscriptionId);
    return this.get(candidateId, subscriptionId);
  }

  delete(candidateId: string, subscriptionId: string): boolean {
    return (
      this.database
        .prepare(
          'DELETE FROM vacancy_subscriptions WHERE candidate_id = ? AND id = ?',
        )
        .run(candidateId, subscriptionId).changes === 1
    );
  }

  private upsertVacancy(
    source: 'hh',
    snapshot: VacancySnapshot,
    observedAt: string,
  ): 'created' | 'updated' | 'unchanged' {
    const serialized = JSON.stringify(snapshot);
    const contentHash = createHash('sha256').update(serialized).digest('hex');
    const existing = this.findVacancy(source, snapshot.id);
    if (!existing) {
      const id = randomUUID();
      this.database
        .prepare(
          `INSERT INTO vacancies
            (id, source, external_id, canonical_url, first_seen_at,
             last_seen_at, latest_version)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          id,
          source,
          snapshot.id,
          snapshot.sourceUrl,
          observedAt,
          observedAt,
        );
      this.insertVersion(id, 1, contentHash, serialized, observedAt);
      return 'created';
    }
    if (existing.content_hash === contentHash) {
      this.database
        .prepare('UPDATE vacancies SET last_seen_at = ? WHERE id = ?')
        .run(observedAt, existing.id);
      return 'unchanged';
    }
    const version = existing.latest_version + 1;
    this.insertVersion(existing.id, version, contentHash, serialized, observedAt);
    this.database
      .prepare(
        `UPDATE vacancies
         SET canonical_url = ?, last_seen_at = ?, latest_version = ?
         WHERE id = ?`,
      )
      .run(snapshot.sourceUrl, observedAt, version, existing.id);
    return 'updated';
  }

  private insertVersion(
    vacancyId: string,
    version: number,
    contentHash: string,
    snapshotJson: string,
    observedAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO vacancy_versions
          (vacancy_id, version, content_hash, snapshot_json, observed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(vacancyId, version, contentHash, snapshotJson, observedAt);
  }

  private subscriptionRows(candidateId: string): SubscriptionRow[] {
    return this.database
      .prepare(
        `${SUBSCRIPTION_SELECT}
         WHERE candidate_id = ?
         ORDER BY created_at DESC, id`,
      )
      .all(candidateId) as unknown as SubscriptionRow[];
  }

  private find(
    candidateId: string,
    subscriptionId: string,
  ): SubscriptionRow | null {
    return (
      (this.database
        .prepare(`${SUBSCRIPTION_SELECT} WHERE candidate_id = ? AND id = ?`)
        .get(candidateId, subscriptionId) as SubscriptionRow | undefined) ??
      null
    );
  }

  private findInternal(subscriptionId: string): SubscriptionRow | null {
    return (
      (this.database
        .prepare(`${SUBSCRIPTION_SELECT} WHERE id = ?`)
        .get(subscriptionId) as SubscriptionRow | undefined) ?? null
    );
  }

  private findVacancy(source: 'hh', externalId: string): VacancyRow | null {
    return (
      (this.database
        .prepare(
          `${VACANCY_SELECT}
           WHERE vacancies.source = ? AND vacancies.external_id = ?`,
        )
        .get(source, externalId) as VacancyRow | undefined) ?? null
    );
  }

  private subscriptionFromRow(
    row: SubscriptionRow,
  ): StoredVacancySubscription {
    return {
      id: row.id,
      source: row.source,
      query: this.openQuery(row),
      cadenceMinutes: row.cadence_minutes,
      status: row.status,
      nextRunAt: row.next_run_at,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      lastErrorCode: row.last_error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      analytics: this.analytics(row.id, row.source_found),
    };
  }

  private openQuery(row: SubscriptionRow): string {
    return this.sealedText.open(
      row.query_cipher,
      subscriptionAssociatedData(row.candidate_id, row.id),
    );
  }

  private analytics(
    subscriptionId: string,
    sourceFound: number | null,
  ): VacancyAnalytics {
    const vacancies = this.database
      .prepare(
        `${VACANCY_SELECT}
         JOIN vacancy_subscription_items AS links ON links.vacancy_id = vacancies.id
         WHERE links.subscription_id = ?`,
      )
      .all(subscriptionId) as unknown as VacancyRow[];
    const observation = this.database
      .prepare(
        `SELECT MIN(versions.observed_at) AS observed_from,
                MAX(versions.observed_at) AS observed_to
         FROM vacancy_versions AS versions
         JOIN vacancy_subscription_items AS links
           ON links.vacancy_id = versions.vacancy_id
         WHERE links.subscription_id = ?`,
      )
      .get(subscriptionId) as {
        observed_from: string | null;
        observed_to: string | null;
      };
    const snapshots = vacancies.map(parseVacancySnapshot);
    return buildVacancyAnalytics(snapshots, observation, sourceFound);
  }

  private linkSampleItems(
    subscriptionId: string,
    sample: HhVacancySample,
  ): { created: number; updated: number; unchanged: number } {
    const counts = { created: 0, updated: 0, unchanged: 0 };
    for (const item of sample.items) {
      const result = this.upsertVacancy(sample.source, item, sample.fetchedAt);
      counts[result] += 1;
      const vacancy = this.findVacancy(sample.source, item.id);
      if (!vacancy) throw new Error('vacancy was not persisted');
      this.database
        .prepare(
          `INSERT INTO vacancy_subscription_items
            (subscription_id, vacancy_id, first_matched_at, last_matched_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(subscription_id, vacancy_id) DO UPDATE SET
             last_matched_at = excluded.last_matched_at`,
        )
        .run(subscriptionId, vacancy.id, sample.fetchedAt, sample.fetchedAt);
    }
    return counts;
  }

  private recordSubscriptionSuccess(
    subscriptionId: string,
    sample: HhVacancySample,
    nextRunAt: string,
  ): void {
    this.database
      .prepare(
        `UPDATE vacancy_subscriptions
         SET next_run_at = ?, last_attempt_at = ?, last_success_at = ?,
             last_error_code = NULL, lease_until = NULL, source_found = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        nextRunAt,
        sample.fetchedAt,
        sample.fetchedAt,
        sample.found,
        sample.fetchedAt,
        subscriptionId,
      );
  }

  private recordSourceSuccess(sample: HhVacancySample): void {
    this.database
      .prepare(
        `INSERT INTO vacancy_source_health
          (source, status, last_attempt_at, last_success_at, last_error_code,
           retry_after_at, consecutive_failures)
         VALUES (?, 'healthy', ?, ?, NULL, NULL, 0)
         ON CONFLICT(source) DO UPDATE SET
           status = 'healthy', last_attempt_at = excluded.last_attempt_at,
           last_success_at = excluded.last_success_at, last_error_code = NULL,
           retry_after_at = NULL, consecutive_failures = 0`,
      )
      .run(sample.source, sample.fetchedAt, sample.fetchedAt);
  }

  private recordSubscriptionFailure(
    subscriptionId: string,
    errorCode: string,
    attemptedAt: string,
    nextRunAt: string,
  ): void {
    this.database
      .prepare(
        `UPDATE vacancy_subscriptions
         SET next_run_at = ?, last_attempt_at = ?, last_error_code = ?,
             lease_until = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(nextRunAt, attemptedAt, errorCode, attemptedAt, subscriptionId);
  }

  private recordSourceFailure(
    source: 'hh',
    errorCode: string,
    attemptedAt: string,
    retryAfterAt?: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO vacancy_source_health
          (source, status, last_attempt_at, last_success_at, last_error_code,
           retry_after_at, consecutive_failures)
         VALUES (?, 'degraded', ?, NULL, ?, ?, 1)
         ON CONFLICT(source) DO UPDATE SET
           status = CASE WHEN vacancy_source_health.consecutive_failures + 1 >= 3
             THEN 'unavailable' ELSE 'degraded' END,
           last_attempt_at = excluded.last_attempt_at,
           last_error_code = excluded.last_error_code,
           retry_after_at = excluded.retry_after_at,
           consecutive_failures = vacancy_source_health.consecutive_failures + 1`,
      )
      .run(source, attemptedAt, errorCode, retryAfterAt ?? null);
  }
}

export class VacancySubscriptionNotFoundError extends Error {}
export class VacancyRefreshConflictError extends Error {}

const SUBSCRIPTION_SELECT = `
  SELECT id, candidate_id, source, query_cipher, cadence_minutes, status,
         next_run_at, last_attempt_at, last_success_at, last_error_code,
         source_found, created_at, updated_at
  FROM vacancy_subscriptions
`;

const VACANCY_SELECT = `
  SELECT vacancies.id, vacancies.source, vacancies.external_id,
         vacancies.canonical_url, vacancies.first_seen_at,
         vacancies.last_seen_at, vacancies.latest_version,
         versions.content_hash, versions.snapshot_json
  FROM vacancies
  JOIN vacancy_versions AS versions
    ON versions.vacancy_id = vacancies.id
   AND versions.version = vacancies.latest_version
`;

function vacancyFromRow(row: VacancyRow): StoredVacancy {
  const snapshot = JSON.parse(row.snapshot_json) as VacancySnapshot;
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    title: snapshot.title,
    company: snapshot.company,
    location: snapshot.location,
    sourceUrl: row.canonical_url,
    publishedAt: snapshot.publishedAt,
    salary: snapshot.salary,
    version: row.latest_version,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function subscriptionAssociatedData(
  candidateId: string,
  subscriptionId: string,
): string {
  return `candidate:${candidateId}:vacancy-subscription:${subscriptionId}:query`;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function parseVacancySnapshot(row: VacancyRow): VacancySnapshot {
  return JSON.parse(row.snapshot_json) as VacancySnapshot;
}

function buildVacancyAnalytics(
  snapshots: VacancySnapshot[],
  observation: { observed_from: string | null; observed_to: string | null },
  sourceFound: number | null,
): VacancyAnalytics {
  const withSalary = snapshots.filter((snapshot) => snapshot.salary !== null);
  return {
    sampleSize: snapshots.length,
    sourceFound,
    salaryKnown: withSalary.length,
    unknownSalary: snapshots.length - withSalary.length,
    observedFrom: observation.observed_from,
    observedTo: observation.observed_to,
    currencies: currencyAnalytics(withSalary),
    topLocations: locationAnalytics(snapshots),
  };
}

function currencyAnalytics(snapshots: VacancySnapshot[]) {
  return Array.from(new Set(snapshots.map((item) => item.salary!.currency)))
    .sort()
    .map((currency) => {
      const salaries = snapshots
        .map((item) => item.salary!)
        .filter((salary) => salary.currency === currency);
      return {
        currency,
        vacancies: salaries.length,
        medianFrom: median(salaries.flatMap((salary) => salary.from ?? [])),
        medianTo: median(salaries.flatMap((salary) => salary.to ?? [])),
      };
    });
}

function locationAnalytics(snapshots: VacancySnapshot[]) {
  const counts = new Map<string, number>();
  snapshots.forEach((item) => {
    counts.set(item.location, (counts.get(item.location) ?? 0) + 1);
  });
  return Array.from(counts, ([location, vacancies]) => ({ location, vacancies }))
    .sort((left, right) => right.vacancies - left.vacancies)
    .slice(0, 5);
}
