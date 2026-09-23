import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';

export interface ApplicationOfferTerms {
  readonly baseSalary?: number;
  readonly bonus?: number;
  readonly equity?: string;
  readonly currency?: string;
  readonly location?: string;
  readonly startDate?: string;
}

export interface StoredApplicationOffer {
  readonly applicationId: string;
  readonly terms: ApplicationOfferTerms;
  readonly respondBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface OfferRow {
  application_id: string;
  terms_cipher: string;
  respond_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `PUT /applications/:id/offer` (B251, S2, architecture.md §3–4). One offer
 * per card (`PK application_id`): a renegotiated offer replaces the terms in
 * place, the history lives in `application_events` if the caller records one.
 */
export class SqliteApplicationOfferRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  put(
    applicationId: string,
    terms: ApplicationOfferTerms,
    respondBy: string | null,
    now = new Date().toISOString(),
  ): StoredApplicationOffer {
    const existing = this.get(applicationId);
    this.database
      .prepare(
        `INSERT INTO application_offers (application_id, terms_cipher, respond_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (application_id) DO UPDATE SET
           terms_cipher = excluded.terms_cipher, respond_by = excluded.respond_by, updated_at = excluded.updated_at`,
      )
      .run(
        applicationId,
        this.sealedText.seal(JSON.stringify(terms), associatedData(applicationId)),
        respondBy,
        existing?.createdAt ?? now,
        now,
      );
    return this.get(applicationId) as StoredApplicationOffer;
  }

  get(applicationId: string): StoredApplicationOffer | null {
    const row = this.database
      .prepare(
        'SELECT application_id, terms_cipher, respond_by, created_at, updated_at FROM application_offers WHERE application_id = ?',
      )
      .get(applicationId) as OfferRow | undefined;
    if (!row) return null;
    return {
      applicationId: row.application_id,
      terms: JSON.parse(this.sealedText.open(row.terms_cipher, associatedData(row.application_id))) as ApplicationOfferTerms,
      respondBy: row.respond_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function associatedData(applicationId: string): string {
  return `application:${applicationId}:offer:terms`;
}
