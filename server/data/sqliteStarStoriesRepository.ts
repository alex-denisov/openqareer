import type { DatabaseSync } from 'node:sqlite';
import {
  MAX_STAR_STORIES_PER_CANDIDATE,
  type StarStoryRecord,
  type StarStoryWriteInput,
} from '../../shared/starStories';
import type { SealedText } from './sealedText';
import { starStoryAssociatedData } from './starStoriesSchema';

export type StoredStarStory = StarStoryRecord;

interface StarStoryRow {
  id: string;
  candidate_id: string;
  body_cipher: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Candidate-owned STAR stories; narrative text is sealed on disk. */
export class SqliteStarStoriesRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  list(candidateId: string): StoredStarStory[] {
    const rows = this.database
      .prepare(
        `SELECT id, candidate_id, body_cipher, version, created_at, updated_at
         FROM candidate_star_stories WHERE candidate_id = ?
         ORDER BY updated_at DESC, id`,
      )
      .all(candidateId) as unknown as StarStoryRow[];
    return rows.map((row) => this.fromRow(candidateId, row));
  }

  get(candidateId: string, id: string): StoredStarStory | null {
    const row = this.database
      .prepare(
        `SELECT id, candidate_id, body_cipher, version, created_at, updated_at
         FROM candidate_star_stories WHERE candidate_id = ? AND id = ?`,
      )
      .get(candidateId, id) as unknown as StarStoryRow | undefined;
    return row ? this.fromRow(candidateId, row) : null;
  }

  create(
    candidateId: string,
    id: string,
    input: StarStoryWriteInput,
    now: string,
  ): StoredStarStory | null {
    const result = this.database
      .prepare(
        `INSERT INTO candidate_star_stories
          (candidate_id, id, body_cipher, version, created_at, updated_at)
         SELECT ?, ?, ?, 1, ?, ?
         WHERE (
           SELECT COUNT(*) FROM candidate_star_stories WHERE candidate_id = ?
         ) < ?`,
      )
      .run(
        candidateId,
        id,
        this.seal(candidateId, id, input),
        now,
        now,
        candidateId,
        MAX_STAR_STORIES_PER_CANDIDATE,
      );
    if (result.changes !== 1) return null;
    const saved = this.get(candidateId, id);
    if (!saved) throw new Error('star_story_insert_missing');
    return saved;
  }

  update(
    candidateId: string,
    id: string,
    expectedVersion: number,
    input: StarStoryWriteInput,
    now: string,
  ): StoredStarStory | null {
    const result = this.database
      .prepare(
        `UPDATE candidate_star_stories
         SET body_cipher = ?, version = version + 1, updated_at = ?
         WHERE candidate_id = ? AND id = ? AND version = ?`,
      )
      .run(this.seal(candidateId, id, input), now, candidateId, id, expectedVersion);
    return result.changes === 1 ? this.get(candidateId, id) : null;
  }

  private seal(candidateId: string, id: string, input: StarStoryWriteInput): string {
    return this.sealedText.seal(JSON.stringify(input), starStoryAssociatedData(candidateId, id));
  }

  private fromRow(candidateId: string, row: StarStoryRow): StoredStarStory {
    const body = JSON.parse(
      this.sealedText.open(row.body_cipher, starStoryAssociatedData(candidateId, row.id)),
    ) as StarStoryWriteInput;
    return {
      ...body,
      id: row.id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
