import type { DatabaseSync } from 'node:sqlite';
import type { LinkedinCurrentSource, LinkedinSection, LinkedinSectionCurrent } from '../../shared/b640LinkedinProfile';
import { LINKEDIN_SECTION_CASCADE, LINKEDIN_SECTION_TABLES } from '../data/linkedinSectionsSchema';

export interface SectionEvents { readonly copiedAt: string | null; readonly pastedAt: string | null }

/** B692: «сейчас» по разделам и отметки кандидата. Только наша база, наружу ничего не уходит. */
export class LinkedinSectionRepository {
  constructor(private readonly database: DatabaseSync, private readonly clock: () => number = Date.now) {
    database.exec(LINKEDIN_SECTION_TABLES);
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'").get()) {
      database.exec(LINKEDIN_SECTION_CASCADE);
    }
  }

  getCurrent(candidateId: string): Map<LinkedinSection, LinkedinSectionCurrent> {
    const rows = this.database.prepare('SELECT section, text, source, captured_at FROM candidate_linkedin_sections WHERE candidate_id = ?')
      .all(candidateId) as unknown as { section: LinkedinSection; text: string; source: LinkedinCurrentSource; captured_at: string }[];
    return new Map(rows.map((row) => [row.section, { text: row.text, source: row.source, capturedAt: row.captured_at }]));
  }

  setCurrent(candidateId: string, section: LinkedinSection, text: string, source: LinkedinCurrentSource): LinkedinSectionCurrent {
    const capturedAt = new Date(this.clock()).toISOString();
    this.database.prepare(`INSERT INTO candidate_linkedin_sections (candidate_id, section, text, source, captured_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(candidate_id, section) DO UPDATE SET text = excluded.text,
      source = excluded.source, captured_at = excluded.captured_at`).run(candidateId, section, text, source, capturedAt);
    return { text, source, capturedAt };
  }

  getEvents(candidateId: string): Map<LinkedinSection, SectionEvents> {
    const rows = this.database.prepare('SELECT section, copied_at, pasted_at FROM candidate_linkedin_section_events WHERE candidate_id = ?')
      .all(candidateId) as unknown as { section: LinkedinSection; copied_at: string | null; pasted_at: string | null }[];
    return new Map(rows.map((row) => [row.section, { copiedAt: row.copied_at, pastedAt: row.pasted_at }]));
  }

  markCopied(candidateId: string, section: LinkedinSection): SectionEvents { return this.mark(candidateId, section, 'copied_at'); }

  markPasted(candidateId: string, section: LinkedinSection): SectionEvents { return this.mark(candidateId, section, 'pasted_at'); }

  private mark(candidateId: string, section: LinkedinSection, column: 'copied_at' | 'pasted_at'): SectionEvents {
    const now = new Date(this.clock()).toISOString();
    this.database.prepare(`INSERT INTO candidate_linkedin_section_events (candidate_id, section, ${column})
      VALUES (?, ?, ?) ON CONFLICT(candidate_id, section) DO UPDATE SET ${column} = excluded.${column}`).run(candidateId, section, now);
    return this.getEvents(candidateId).get(section) ?? { copiedAt: null, pastedAt: null };
  }
}
