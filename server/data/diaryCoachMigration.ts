import { MIGRATION_40 } from './consultantHistorySchema';

// Rebuild the constrained history tables inside the migration transaction.
// Children are backed up and dropped first: ON DELETE CASCADE loses no history.
const historyTables = ['consultant_conversations', 'consultant_conversation_messages', 'consultant_conversation_turns', 'consultant_summaries', 'consultant_summary_claims'];
export const MIGRATION_DIARY_COACH_STAGE = [
  ...historyTables.map(table => `CREATE TEMP TABLE diary_backup_${table} AS SELECT * FROM ${table};`),
  ...[...historyTables].reverse().map(table => `DROP TABLE ${table};`),
  MIGRATION_40.replaceAll("'responses', 'interviews'", "'responses', 'interviews', 'diary'"),
  ...historyTables.map(table => `INSERT INTO ${table} SELECT * FROM diary_backup_${table}; DROP TABLE diary_backup_${table};`),
].join('\n');
