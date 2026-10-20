import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_40 } from './consultantHistorySchema';
import { MIGRATION_DIARY_COACH_STAGE } from './diaryCoachMigration';

describe('B357 diary history migration', () => {
  it('preserves history, summaries and relationships with FK enforcement and repeated migration', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec("PRAGMA foreign_keys=ON; CREATE TABLE candidates(id TEXT PRIMARY KEY); CREATE TABLE messages(candidate_id TEXT, id TEXT, PRIMARY KEY(candidate_id,id)); INSERT INTO candidates VALUES('candidate'); INSERT INTO messages VALUES('candidate','message');");
      db.exec(MIGRATION_40);
      db.exec("INSERT INTO consultant_conversations(id,candidate_id,stage,opened_at,last_message_at) VALUES('conversation','candidate','career','2026-10-01','2026-10-01'); INSERT INTO consultant_conversation_messages VALUES('candidate','conversation','message','user','career','2026-10-01',1); INSERT INTO consultant_conversation_turns VALUES('candidate','key','conversation'); INSERT INTO consultant_summaries VALUES('summary','candidate','conversation',1,1,'encrypted-payload','fixture','fixture',1,1,'2026-10-01'); INSERT INTO consultant_summary_claims VALUES('candidate','conversation',1,'2026-10-01');");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        db.exec('BEGIN IMMEDIATE');
        db.exec(MIGRATION_DIARY_COACH_STAGE);
        db.exec('COMMIT');
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(db.prepare('SELECT summary_cipher FROM consultant_summaries').get()?.summary_cipher).toBe('encrypted-payload');
        expect(db.prepare('SELECT COUNT(*) AS count FROM consultant_conversation_messages').get()?.count).toBe(1);
        expect(db.prepare('SELECT COUNT(*) AS count FROM consultant_conversation_turns').get()?.count).toBe(1);
        expect(db.prepare('SELECT COUNT(*) AS count FROM consultant_summary_claims').get()?.count).toBe(1);
      }
      db.exec("UPDATE consultant_conversations SET stage='diary'; UPDATE consultant_conversation_messages SET stage='diary';");
      expect(db.prepare('SELECT stage FROM consultant_conversations').get()?.stage).toBe('diary');
      db.exec("DELETE FROM candidates WHERE id='candidate'");
      expect(db.prepare('SELECT COUNT(*) AS count FROM consultant_summaries').get()?.count).toBe(0);
    } finally { db.close(); }
  });
});
