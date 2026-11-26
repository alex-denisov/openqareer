import type { DatabaseSync } from 'node:sqlite';
import { stampContractEnd } from '../auth/legalConsentStore';

/**
 * B739: таблицы со строками кандидата, которые не уходят каскадом от `candidates` (нет внешнего
 * ключа или триггера). Удаление аккаунта стирает их явно, в одной транзакции с кандидатом.
 * Таблицы, которых в базе ещё нет (маршрут под флагом не открывался), пропускаются.
 */
export const PURGED_BY_CANDIDATE_ID: readonly string[] = [
  'application_referral_track',
  'application_star_prep',
  'billing_quota_events',
  'candidate_action_batches',
  'candidate_action_daily_usage',
  'candidate_action_receipts',
  'candidate_career_vector',
  'candidate_contact_messages',
  'candidate_contact_status',
  'candidate_decision_profile',
  'candidate_draft_workflow',
  'candidate_feed_posts',
  'candidate_linkedin_queue',
  'candidate_linkedin_rhythm',
  'consultant_messages_fts',
  'consultant_rejections',
  'hh_raise_choices',
  'hh_raise_schedules',
  'hh_raise_tasks',
  'hh_text_role_targets',
  'message_stages',
  'plan_requests',
  'search_consents',
  'turn_stages',
];

function tableExists(database: DatabaseSync, table: string): boolean {
  return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

/**
 * Стирает строки кандидата без каскада. Запись об акцепте условий остаётся по политике
 * (B195: три года с даты прекращения договора); здесь ставится эта дата, как при удалении
 * администратором, иначе уборка по срокам запись не тронула бы никогда.
 */
export function purgeCandidateRows(database: DatabaseSync, candidateId: string, now = new Date()): void {
  if (tableExists(database, 'legal_consents') && tableExists(database, 'users')) {
    const users = database.prepare('SELECT id FROM users WHERE candidate_id = ?').all(candidateId) as Array<{
      id: string;
    }>;
    for (const { id } of users) stampContractEnd(database, id, now.toISOString());
  }
  for (const table of PURGED_BY_CANDIDATE_ID) {
    if (tableExists(database, table)) {
      database.prepare(`DELETE FROM "${table}" WHERE candidate_id = ?`).run(candidateId);
    }
  }
}
