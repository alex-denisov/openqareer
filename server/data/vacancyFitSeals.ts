import type { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { gunzipSync, gzip } from 'node:zlib';
import { syncSection } from '../observability/syncSections';
import { writeBriefly } from './sqliteBriefLock';
import { retryOnSqliteBusy } from './sqliteBusyRetry';
import type { SealedText } from './sealedText';

/**
 * B702 part 2 (prod 24.11 18:57Z): the first list of a role in a new process waited 23.8 s while its
 * snapshot answered in 2 ms. 8 s opened all 27 107 stored results (116 MB) for their vacancy ids and
 * 11 s read 910 percents again. Both are kept as one sealed row per candidate. A cache, not a record.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS vacancy_fit_seals (
  candidate_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('ids', 'views')),
  stamp TEXT NOT NULL,
  built_at INTEGER NOT NULL,
  cipher TEXT NOT NULL,
  PRIMARY KEY (candidate_key, kind)
)`;

export type VacancyFitSealKind = 'ids' | 'views';

/** Off-loop waits for a taken write lock, longer together than the lock of a starting slot. */
const BUSY_RETRY_MS: readonly number[] = [250, 1_000, 3_000, 5_000, 10_000];

const gzipInPool = promisify(gzip);

export class VacancyFitSeals {
  /** A candidate deleted while their row was packed: writing it would bring it back. */
  private readonly deleted = new Set<string>();

  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    database.exec(SCHEMA);
  }

  /** The stored text under this stamp built after `builtAfter`; a row that does not open is none. */
  read(candidateKey: string, kind: VacancyFitSealKind, stamp: string, builtAfter = 0): string | undefined {
    return syncSection(`fit-seal:read-${kind}`, () => {
      const row = this.database
        .prepare('SELECT cipher FROM vacancy_fit_seals WHERE candidate_key=? AND kind=? AND stamp=? AND built_at>?')
        .get(candidateKey, kind, stamp, builtAfter) as { cipher: string } | undefined;
      if (!row) return undefined;
      try {
        const packed = this.sealedText.open(row.cipher, this.associatedData(candidateKey, kind, stamp));
        return gunzipSync(Buffer.from(packed, 'base64')).toString('utf8');
      } catch {
        return undefined;
      }
    });
  }

  /** Packed in the thread pool; the write waits for the lock off the event loop. */
  async write(candidateKey: string, kind: VacancyFitSealKind, stamp: string, text: string, builtAt = Date.now()): Promise<void> {
    const packed = (await gzipInPool(Buffer.from(text, 'utf8'))).toString('base64');
    const cipher = syncSection('fit-seal:store', () =>
      this.sealedText.seal(packed, this.associatedData(candidateKey, kind, stamp)),
    );
    await retryOnSqliteBusy(
      () => {
        if (this.deleted.has(candidateKey)) return;
        syncSection('fit-seal:store', () =>
          writeBriefly(this.database, () =>
            this.database
              .prepare(
                `INSERT INTO vacancy_fit_seals (candidate_key, kind, stamp, built_at, cipher) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(candidate_key, kind) DO UPDATE SET stamp=excluded.stamp, built_at=excluded.built_at, cipher=excluded.cipher
                 WHERE excluded.built_at >= vacancy_fit_seals.built_at`,
              )
              .run(candidateKey, kind, stamp, builtAt, cipher),
          ),
        );
      },
      { delaysMs: BUSY_RETRY_MS },
    );
  }

  delete(candidateKey: string): void {
    this.deleted.add(candidateKey);
    this.database.prepare('DELETE FROM vacancy_fit_seals WHERE candidate_key=?').run(candidateKey);
  }

  private associatedData(candidateKey: string, kind: string, stamp: string): string {
    return `vacancy-fit-seal:${kind}:${candidateKey}:${stamp}`;
  }
}
