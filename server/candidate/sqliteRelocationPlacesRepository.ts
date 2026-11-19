import type { DatabaseSync } from 'node:sqlite';
import { placesSchema, type RelocationPlaceChoice } from '../domain/relocationPlaces';

/**
 * B672: выбранные места релокации кандидата — одна строка на кандидата со
 * списком мест и разделами трат «Не про меня». Запись заменяет список целиком.
 */
export const RELOCATION_PLACES_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_relocation_places (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  places_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

export interface SavedRelocationPlaces {
  readonly saved: boolean;
  readonly places: readonly RelocationPlaceChoice[];
  readonly updatedAt: string | null;
}

const EMPTY: SavedRelocationPlaces = { saved: false, places: [], updatedAt: null };

export class SqliteRelocationPlacesRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(RELOCATION_PLACES_SCHEMA);
  }

  read(candidateId: string): SavedRelocationPlaces {
    const row = this.database
      .prepare(
        'SELECT places_json, updated_at FROM candidate_relocation_places WHERE candidate_id = ?',
      )
      .get(candidateId) as { places_json: string; updated_at: string } | undefined;
    if (!row) return EMPTY;
    let stored: unknown;
    try {
      stored = JSON.parse(row.places_json);
    } catch {
      return EMPTY;
    }
    // Место, которого больше нет в расчёте (страна без шкалы, город без каталога), не ломает список.
    const parsed = placesSchema.safeParse({ places: stored });
    return parsed.success
      ? { saved: true, places: parsed.data.places, updatedAt: row.updated_at }
      : EMPTY;
  }

  replace(
    candidateId: string,
    places: readonly RelocationPlaceChoice[],
    now: string,
  ): SavedRelocationPlaces {
    this.database
      .prepare(
        `INSERT INTO candidate_relocation_places (candidate_id, places_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET places_json = excluded.places_json,
           updated_at = excluded.updated_at`,
      )
      .run(candidateId, JSON.stringify(places), now);
    return { saved: true, places, updatedAt: now };
  }
}
