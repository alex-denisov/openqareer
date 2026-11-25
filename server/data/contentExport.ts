import type { DatabaseSync } from 'node:sqlite';
import type { TextVariant, TextVariantKind } from '../../shared/textVariants';
import { SqliteTextVariantRepository } from '../candidate/sqliteTextVariantRepository';
import { SqliteResumeEditChoicesRepository } from '../candidate/sqliteResumeEditChoicesRepository';
import type { ResumeEditChoices } from '../../shared/resumeVacancyEdits';
import { tableExists } from './exportTableReader';

/**
 * B738 · 4: черновики постов и комментариев, их согласование и темы, посты ленты, другие варианты
 * текстов и всё по LinkedIn — разделы профиля, отметки, варианты предложений, ритм и очередь.
 * Открытые таблицы читаются прямо; варианты текстов запечатаны и открываются своим репозиторием.
 */
export interface ContentExportSources {
  readonly database: DatabaseSync;
  readonly encryptionKey: Buffer;
}

type Row = Record<string, unknown>;

export interface ExportedTextVariants {
  readonly kind: TextVariantKind;
  readonly subjectId: string;
  readonly variants: readonly TextVariant[];
}

export interface ContentExport {
  readonly drafts: readonly Row[];
  readonly draftWorkflow: readonly Row[];
  readonly draftTopicDecisions: readonly Row[];
  readonly feedPosts: readonly Row[];
  readonly textVariants: readonly ExportedTextVariants[];
  readonly resumeEdits: ReadonlyArray<{ vacancyId: string; choices: ResumeEditChoices }>;
  readonly linkedin: {
    readonly sections: readonly Row[];
    readonly sectionEvents: readonly Row[];
    readonly offerVariants: readonly Row[];
    readonly rhythm: Row | null;
    readonly queue: readonly Row[];
  };
}

/** Строки таблицы кандидата под именами экрана; таблицы, которой ещё нет в базе, — пусто. */
function rows(database: DatabaseSync, table: string, sql: string, candidateId: string): Row[] {
  if (!tableExists(database, table)) return [];
  return database.prepare(sql).all(candidateId) as Row[];
}

function readTextVariants(sources: ContentExportSources, candidateId: string): ExportedTextVariants[] {
  const subjects = rows(
    sources.database,
    'text_variants',
    'SELECT DISTINCT kind, subject_id AS subjectId FROM text_variants WHERE candidate_id = ? ORDER BY kind, subject_id',
    candidateId,
  ) as { kind: TextVariantKind; subjectId: string }[];
  if (subjects.length === 0) return [];
  const repository = new SqliteTextVariantRepository(sources.database, sources.encryptionKey);
  return subjects.map(({ kind, subjectId }) => ({
    kind,
    subjectId,
    variants: repository.list({ candidateId, kind, subjectId }, 'all').variants,
  }));
}

/** a05e: столбцы ритма комментариев есть, только если таблицу уже дополнил репозиторий очереди. */
function commentRhythmColumns(database: DatabaseSync): string {
  if (!tableExists(database, 'candidate_linkedin_rhythm')) return '';
  const columns = database.prepare('PRAGMA table_info(candidate_linkedin_rhythm)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'comments_per_day')) return '';
  return ', comments_per_day AS commentsPerDay, comment_days AS commentDays, comment_from AS commentFrom, comment_to AS commentTo';
}

function readLinkedin(database: DatabaseSync, candidateId: string): ContentExport['linkedin'] {
  const rhythm = rows(
    database,
    'candidate_linkedin_rhythm',
    `SELECT posts_per_week AS postsPerWeek, days, time, timezone, updated_at AS updatedAt${commentRhythmColumns(database)}
     FROM candidate_linkedin_rhythm WHERE candidate_id = ?`,
    candidateId,
  );
  return {
    sections: rows(
      database,
      'candidate_linkedin_sections',
      `SELECT section, text, source, captured_at AS capturedAt
       FROM candidate_linkedin_sections WHERE candidate_id = ? ORDER BY section`,
      candidateId,
    ),
    sectionEvents: rows(
      database,
      'candidate_linkedin_section_events',
      `SELECT section, copied_at AS copiedAt, pasted_at AS pastedAt
       FROM candidate_linkedin_section_events WHERE candidate_id = ? ORDER BY section`,
      candidateId,
    ),
    offerVariants: rows(
      database,
      'candidate_linkedin_offer_variants',
      `SELECT offer_key AS offerKey, position, text, created_at AS createdAt
       FROM candidate_linkedin_offer_variants WHERE candidate_id = ? ORDER BY offer_key, position`,
      candidateId,
    ),
    rhythm: rhythm[0] ?? null,
    queue: rows(
      database,
      'candidate_linkedin_queue',
      `SELECT id, draft_id AS draftId, kind, scheduled_at AS scheduledAt, state,
         published_url AS publishedUrl, reminded_at AS remindedAt, created_at AS createdAt, updated_at AS updatedAt
       FROM candidate_linkedin_queue WHERE candidate_id = ? ORDER BY scheduled_at, id`,
      candidateId,
    ),
  };
}

export function exportContent(sources: ContentExportSources, candidateId: string): ContentExport {
  const { database } = sources;
  return {
    drafts: rows(
      database,
      'candidate_drafts',
      `SELECT id, kind, topic, target_post_url AS targetPostUrl, text, status, local_date AS localDate,
         created_at AS createdAt, updated_at AS updatedAt
       FROM candidate_drafts WHERE candidate_id = ? ORDER BY created_at, id`,
      candidateId,
    ),
    draftWorkflow: rows(
      database,
      'candidate_draft_workflow',
      `SELECT draft_id AS draftId, approved_at AS approvedAt, published_at AS publishedAt, updated_at AS updatedAt
       FROM candidate_draft_workflow WHERE candidate_id = ? ORDER BY approved_at, draft_id`,
      candidateId,
    ),
    draftTopicDecisions: rows(
      database,
      'candidate_draft_topic_decisions',
      `SELECT topic_id AS topicId, decision, decided_at AS decidedAt
       FROM candidate_draft_topic_decisions WHERE candidate_id = ? ORDER BY decided_at, topic_id`,
      candidateId,
    ),
    feedPosts: rows(
      database,
      'candidate_feed_posts',
      `SELECT draft_id AS draftId, post_url AS postUrl, excerpt, created_at AS createdAt
       FROM candidate_feed_posts WHERE candidate_id = ? ORDER BY created_at, draft_id`,
      candidateId,
    ),
    textVariants: readTextVariants(sources, candidateId),
    resumeEdits: tableExists(database, 'candidate_resume_edit_choices')
      ? new SqliteResumeEditChoicesRepository(database, sources.encryptionKey).list(candidateId)
      : [],
    linkedin: readLinkedin(database, candidateId),
  };
}
