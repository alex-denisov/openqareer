import { SEO_GOAL_MIGRATION } from '../seoGoalSchema';
import { MIGRATION_ADAPTATION_APPLICATIONS } from '../adaptationApplications';
import { MIGRATION_DIARY_COACH_STAGE } from '../diaryCoachMigration';
import type { DatabaseSync } from 'node:sqlite';
import {
  MIGRATION_1,
  MIGRATION_2,
  MIGRATION_3,
  MIGRATION_4,
  MIGRATION_5,
  MIGRATION_6,
  MIGRATION_7,
  MIGRATION_8,
  MIGRATION_9,
  MIGRATION_10,
  MIGRATION_11,
  MIGRATION_12,
  MIGRATION_13,
  MIGRATION_14,
  MIGRATION_15,
  MIGRATION_16,
  MIGRATION_17,
  MIGRATION_18,
  MIGRATION_19,
  MIGRATION_20,
  MIGRATION_21,
  MIGRATION_24,
  MIGRATION_25,
  MIGRATION_26,
  MIGRATION_28,
  MIGRATION_30,
  MIGRATION_31,
  MIGRATION_32,
  MIGRATION_33,
  MIGRATION_34,
  MIGRATION_35,
  MIGRATION_36,
  MIGRATION_38,
  MIGRATION_39,
} from '../sqliteSchema';
import { RESUME_VERSION_MIGRATION } from '../resumeVersionSchema';
import { PROFILE_REVISION_EXPERIENCE_LINKS_MIGRATION } from '../profileRevisionSchema';
import { MIGRATION_40 } from '../consultantHistorySchema';
import { MIGRATION_BILLING } from '../../billing/billingSchema';
import { MIGRATION_PRO_TRIAL } from '../../billing/proTrialSchema';
import { MIGRATION_41 as MIGRATION_EXECUTIVE_REQUEST } from '../executiveRequestSchema';
import { MIGRATION_47 as MIGRATION_ROLE_SKILL_ASSESSMENT } from '../roleSkillAssessmentSchema';
import { MIGRATION_48 as MIGRATION_STAR_STORIES } from '../starStoriesSchema';
import { MIGRATION_49 as MIGRATION_INTERVIEW_SIMULATOR } from '../interviewSimulatorSchema';

export const MIGRATIONS = [
  MIGRATION_1,
  MIGRATION_2,
  MIGRATION_3,
  MIGRATION_4,
  MIGRATION_5,
  MIGRATION_6,
  MIGRATION_7,
  MIGRATION_8,
  MIGRATION_9,
  MIGRATION_10,
  MIGRATION_11,
  MIGRATION_12,
  MIGRATION_13,
  MIGRATION_14,
  MIGRATION_15,
  MIGRATION_16,
  MIGRATION_17,
  MIGRATION_18,
  MIGRATION_19,
  MIGRATION_20,
  MIGRATION_21,
  // Номер константы (24) больше номера версии: `MIGRATION_22` и `MIGRATION_23`
  // применяют своими соединениями служба входа и хранилище пула вакансий.
  MIGRATION_24,
  MIGRATION_25,
  MIGRATION_26,
  // `MIGRATION_27` применяет своим соединением кэш называния ролей.
  MIGRATION_28,
  // `MIGRATION_29` применяет своим соединением служба согласий.
  MIGRATION_30,
  MIGRATION_31,
  MIGRATION_32,
  MIGRATION_33,
  MIGRATION_34,
  MIGRATION_35,
  MIGRATION_36,
  MIGRATION_38,
  MIGRATION_39,
  MIGRATION_40,
  // B345 сохраняет номер 41; идемпотентная миграция B471 добавляется следом.
  MIGRATION_BILLING,
  MIGRATION_EXECUTIVE_REQUEST,
  // B474 занимает 45/46; миграции линии C идут далее.
  MIGRATION_ROLE_SKILL_ASSESSMENT,
  MIGRATION_STAR_STORIES,
  MIGRATION_INTERVIEW_SIMULATOR,
  // Resume-version storage is appended to preserve all existing index-assigned migration ids.
  RESUME_VERSION_MIGRATION,
  PROFILE_REVISION_EXPERIENCE_LINKS_MIGRATION,
  MIGRATION_PRO_TRIAL,
  MIGRATION_DIARY_COACH_STAGE,
  MIGRATION_ADAPTATION_APPLICATIONS,
  SEO_GOAL_MIGRATION,
] as const;

export function applyMigrations(
  database: DatabaseSync,
  inTransaction: (operation: () => void) => void,
  migrations: readonly string[] = MIGRATIONS,
): void {
  database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
  const row = database
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null };
  migrations.forEach((migration, index) => {
    const version = index + 1;
    if ((row.version ?? 0) < version) {
      inTransaction(() => {
        database.exec(migration);
        database
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
          )
          .run(version, new Date().toISOString());
      });
    }
  });
}
