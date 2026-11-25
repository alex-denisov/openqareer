import type { DatabaseSync } from 'node:sqlite';
import { postingKey, rowIds, type SentLookup } from '../domain/sentApplication';
import type { VacancyApplicationSnapshot } from '../../shared/vacancyApplication';
import type { SealedText } from './sealedText';

/**
 * B801: по какому объявлению отклик отправлен. Снимок вакансии зашифрован, поэтому адрес с названием
 * хранится отпечатком: поиск точечный, весь список откликов не читается. Новая таблица, без ALTER (B230).
 */
export const SENT_POSTING_SCHEMA = `
CREATE TABLE IF NOT EXISTS application_sent_postings (
  application_id TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  posting_token TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS application_sent_postings_token
  ON application_sent_postings(candidate_id, posting_token);
`;

const SENT = "stage NOT IN ('saved', 'archived')";

/** Снимок вакансии отклика: адрес, с которым он ушёл. */
type ReadVacancy = (candidateId: string, applicationId: string) => VacancyApplicationSnapshot | null;

export class SentPostingIndex {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
    private readonly readVacancy: ReadVacancy,
  ) {
    database.exec(SENT_POSTING_SCHEMA);
  }

  /** Id отправленного отклика на эту же вакансию: по id строки или кластера, затем по объявлению. */
  find(candidateId: string, lookup: SentLookup): string | null {
    return this.byCluster(candidateId, lookup.clusterId) ?? this.byPosting(candidateId, lookup);
  }

  private byCluster(candidateId: string, clusterId: string): string | null {
    const ids = rowIds(clusterId);
    const row = this.database
      .prepare(
        `SELECT id FROM applications
          WHERE candidate_id = ? AND cluster_id IN (${marks(ids)}) AND ${SENT} LIMIT 1`,
      )
      .get(candidateId, ...ids) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private byPosting(candidateId: string, { title, urls }: SentLookup): string | null {
    const tokens = urls.flatMap((url) => this.token(candidateId, url, title) ?? []);
    if (tokens.length === 0) return null;
    this.indexMissing(candidateId);
    const row = this.database
      .prepare(
        `SELECT a.id FROM application_sent_postings p JOIN applications a ON a.id = p.application_id
          WHERE p.candidate_id = ? AND p.posting_token IN (${marks(tokens)}) AND a.${SENT} LIMIT 1`,
      )
      .get(candidateId, ...tokens) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** Расшифровываются только отправленные отклики, которых ещё нет в указателе: каждый — один раз. */
  private indexMissing(candidateId: string): void {
    const missing = this.database
      .prepare(
        `SELECT a.id FROM applications a
          WHERE a.candidate_id = ? AND a.${SENT}
            AND NOT EXISTS (SELECT 1 FROM application_sent_postings p WHERE p.application_id = a.id)`,
      )
      .all(candidateId) as unknown as { id: string }[];
    if (missing.length === 0) return;
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO application_sent_postings (application_id, candidate_id, posting_token)
       VALUES (?, ?, ?)`,
    );
    for (const { id } of missing) {
      const vacancy = this.readVacancy(candidateId, id);
      insert.run(id, candidateId, this.token(candidateId, vacancy?.url, vacancy?.title));
    }
  }

  private token(candidateId: string, url: string | null | undefined, title: string | undefined) {
    const key = postingKey(url, title);
    return key && this.sealedText.indexToken(`candidate:${candidateId}:sent-posting`, key);
  }
}

const marks = (values: readonly string[]): string => values.map(() => '?').join(', ');
