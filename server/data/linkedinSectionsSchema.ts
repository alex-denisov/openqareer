/**
 * B692: разделы профиля LinkedIn и отметки; B645: варианты «Предложить заново». Новые таблицы,
 * существующие не меняются. `candidate_linkedin_sections` (ручная вставка «сейчас») с B645 не пишется.
 */
export const LINKEDIN_SECTION_TABLES = `
CREATE TABLE IF NOT EXISTS candidate_linkedin_sections (
  candidate_id TEXT NOT NULL,
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, section)
) STRICT;
CREATE TABLE IF NOT EXISTS candidate_linkedin_section_events (
  candidate_id TEXT NOT NULL,
  section TEXT NOT NULL,
  copied_at TEXT,
  pasted_at TEXT,
  PRIMARY KEY (candidate_id, section)
) STRICT;
CREATE TABLE IF NOT EXISTS candidate_linkedin_offer_variants (
  candidate_id TEXT NOT NULL,
  offer_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, offer_key, position)
) STRICT;
`;

/** Данные кандидата уходят вместе с его строкой; триггер ставится, только если таблица кандидатов есть. */
export const LINKEDIN_SECTION_CASCADE = `
CREATE TRIGGER IF NOT EXISTS candidate_linkedin_sections_delete_candidate
  AFTER DELETE ON candidates
  BEGIN
    DELETE FROM candidate_linkedin_sections WHERE candidate_id = OLD.id;
    DELETE FROM candidate_linkedin_section_events WHERE candidate_id = OLD.id;
  END;
CREATE TRIGGER IF NOT EXISTS candidate_linkedin_offer_variants_delete_candidate
  AFTER DELETE ON candidates
  BEGIN
    DELETE FROM candidate_linkedin_offer_variants WHERE candidate_id = OLD.id;
  END;
`;
