import type { CandidateExport } from './candidateStore';

/**
 * B689: чем покрыта в выгрузке «Скачать мои данные» каждая таблица базы кандидата со столбцом
 * `candidate_id` или ссылкой на `candidates`. Тест сверяет список со схемой: новая таблица без
 * строки здесь роняет тест, так что выгрузку нельзя забыть.
 *
 * - `export` — данные лежат в выгрузке под этим ключом;
 * - `internal` — служебная строка без содержимого кандидата (счётчик, индекс, секрет, кэш);
 * - `gap` — данные кандидата, которых в выгрузке ещё нет; закрываются отдельной задачей.
 *   Таблицы дневника (`career_diary_*`) сюда не допускаются.
 */
export type CandidateTableCoverage =
  | { readonly export: keyof CandidateExport }
  /** Ключ, который маршрут выгрузки добавляет поверх хранилища (`handleExportCandidate`). */
  | { readonly routeExport: 'reputationAudits' | 'footprintAudits' }
  | { readonly internal: string }
  | { readonly gap: string };

const GAP_TRACKER = 'отклики и трекер: в выгрузку пока не входят';
const GAP_NOTIFICATIONS = 'уведомления и их настройки: в выгрузку пока не входят';
const GAP_PROFILE = 'история и производные профиля: в выгрузку пока не входят';
const GAP_ACCOUNT = 'учётная запись и кабинет: в выгрузку пока не входят';
const GAP_AUTOMATION = 'автоотклики и hh.ru: в выгрузку пока не входят';
const GAP_CONTENT = 'черновики, посты, тексты и LinkedIn: в выгрузку пока не входят';
const GAP_CONTACTS = 'контакты и переписка: в выгрузку пока не входят';
const GAP_CAREER = 'карьерные разделы кабинета: в выгрузку пока не входят';
const MIGRATION_COPY = 'временная копия таблицы при перестройке схемы';

export const CANDIDATE_TABLE_COVERAGE: Readonly<Record<string, CandidateTableCoverage>> = {
  // Снимок кандидата.
  candidate_import_sources: { export: 'importedSources' },
  conversations: { export: 'messages' },
  messages: { export: 'messages' },
  memory: { export: 'memory' },
  turns: { export: 'turns' },
  assessments: { export: 'assessments' },
  market_profiles: { export: 'germanyMarket' },
  resume_drafts: { export: 'resume' },
  candidate_documents: { export: 'documentContents' },
  vacancy_subscriptions: { export: 'vacancySubscriptions' },
  // Остальные разделы.
  consultant_conversations: { export: 'consultantConversations' },
  executive_requests: { export: 'executiveRequests' },
  candidate_source_connections: { export: 'sourceConnections' },
  career_strategies: { export: 'careerStrategy' },
  work_preference_runs: { export: 'workPreferences' },
  relocation_questionnaire_profiles: { export: 'relocationQuestionnaire' },
  relocation_questionnaire_consents: { export: 'relocationConsent' },
  relocation_scenarios: { export: 'relocationScenarios' },
  role_skill_assessment_runs: { export: 'roleSkillAssessments' },
  candidate_star_stories: { export: 'starStories' },
  candidate_interview_sessions: { export: 'interviewSession' },
  // Дневник.
  career_diary_interview_practices: { export: 'interviewPractices' },
  career_diary_adaptation_applications: { export: 'adaptationApplications' },
  career_diary_entries: { export: 'careerDiaryEntries' },
  career_diary_week_summaries: { export: 'careerDiaryEntries' },
  career_diary_goals: { export: 'careerDiary' },
  career_diary_measurements: { export: 'careerDiary' },
  career_diary_goal_details: { export: 'careerDiary' },
  career_diary_weekly_reviews: { export: 'careerDiary' },
  career_diary_achievements: { export: 'careerDiary' },
  career_diary_workplaces: { export: 'careerDiary' },
  career_diary_adaptation_details: { export: 'careerDiary' },
  career_diary_checkpoints: { export: 'careerDiary' },
  career_diary_people: { export: 'careerDiary' },
  career_diary_kpi_imports: { export: 'careerDiary' },
  career_diary_kpi_attempts: { internal: 'время попыток разбора KPI для предела, без содержимого' },
  // Добавляет маршрут выгрузки.
  candidate_reputation_audits: { routeExport: 'reputationAudits' },
  candidate_footprint_audits: { routeExport: 'footprintAudits' },
  // Служебные.
  assessments_product_case_only: { internal: MIGRATION_COPY },
  vacancy_subscriptions_v14: { internal: MIGRATION_COPY },
  vacancy_subscriptions_v15: { internal: MIGRATION_COPY },
  vacancy_source_health_v15: { internal: MIGRATION_COPY },
  candidate_account_deletions: { internal: 'срок отложенного удаления аккаунта' },
  candidate_action_daily_usage: { internal: 'дневной счётчик действий' },
  candidate_auto_apply_runtime: { internal: 'состояние фонового запуска автооткликов' },
  consultant_conversation_resumes: { internal: 'отметка возобновления разговора консультанта' },
  hh_text_role_targets: { internal: 'очередь опроса hh.ru по роли поиска' },
  billing_quota_events: { internal: 'счётчик расхода квоты тарифа' },
  email_verifications: { internal: 'одноразовые коды подтверждения почты' },
  candidate_notification_telegram_link_codes: { internal: 'одноразовые коды привязки Telegram' },
  candidate_notification_unsubscribe_tokens: { internal: 'секреты ссылок отписки' },
  consultant_messages_fts: { internal: 'поисковый индекс по сообщениям, которые уже в выгрузке' },
  consultant_conversation_messages: { internal: 'индекс сообщений по разговорам консультанта' },
  consultant_conversation_turns: { internal: 'индекс ходов по разговорам консультанта' },
  consultant_history_backfill: { internal: 'отметка переноса истории консультанта' },
  consultant_summary_claims: { internal: 'блокировка фоновой сводки' },
  message_stages: { internal: 'этап и тема сообщений, которые уже в выгрузке' },
  turn_stages: { internal: 'этап и тема ходов, которые уже в выгрузке' },
  memory_revisions: { internal: 'журнал правок памяти: действие и отпечаток, без текста' },
  candidate_application_operations: { internal: 'кэш повторов запросов трекера' },
  matched_snapshot_seals: { internal: 'кэш подборки вакансий, пересчитывается' },
  sealed_matched_lists: { internal: 'кэш подборки вакансий, пересчитывается' },
  // Ещё не в выгрузке.
  applications: { gap: GAP_TRACKER },
  application_contacts: { gap: GAP_TRACKER },
  application_employer_reads: { gap: GAP_TRACKER },
  application_events: { gap: GAP_TRACKER },
  application_label_assignments: { gap: GAP_TRACKER },
  application_referral_track: { gap: GAP_TRACKER },
  application_retry_requests: { gap: GAP_TRACKER },
  application_star_prep: { gap: GAP_TRACKER },
  candidate_application_labels: { gap: GAP_TRACKER },
  candidate_outreach: { gap: GAP_TRACKER },
  vacancy_applications: { gap: GAP_TRACKER },
  vacancy_skips: { gap: GAP_TRACKER },
  career_commands: { gap: GAP_TRACKER },
  career_command_approvals: { gap: GAP_TRACKER },
  career_command_outbox: { gap: GAP_TRACKER },
  candidate_notifications: { gap: GAP_NOTIFICATIONS },
  candidate_notification_deliveries: { gap: GAP_NOTIFICATIONS },
  candidate_notification_invitation_events: { gap: GAP_NOTIFICATIONS },
  candidate_notification_invitation_preferences: { gap: GAP_NOTIFICATIONS },
  candidate_notification_preferences: { gap: GAP_NOTIFICATIONS },
  candidate_notification_telegram_chats: { gap: GAP_NOTIFICATIONS },
  candidate_notification_telegram_preferences: { gap: GAP_NOTIFICATIONS },
  candidate_resume_versions: { gap: GAP_PROFILE },
  candidate_media: { gap: GAP_PROFILE },
  profile_change_log: { gap: GAP_PROFILE },
  profile_revisions: { gap: GAP_PROFILE },
  profile_revision_experience_links: { gap: GAP_PROFILE },
  candidate_career_vector: { gap: GAP_PROFILE },
  candidate_decision_profile: { gap: GAP_PROFILE },
  candidate_goal_markers: { gap: GAP_PROFILE },
  candidate_import_walks: { gap: GAP_PROFILE },
  candidate_interview_design_schemas: { gap: GAP_PROFILE },
  candidate_interview_review_helpful: { gap: GAP_PROFILE },
  skill_quiz_attempts: { gap: GAP_PROFILE },
  consultant_rejections: { gap: GAP_PROFILE },
  consultant_summaries: { gap: GAP_PROFILE },
  users: { gap: GAP_ACCOUNT },
  candidate_workspaces: { gap: GAP_ACCOUNT },
  candidate_visits: { gap: GAP_ACCOUNT },
  plan_requests: { gap: GAP_ACCOUNT },
  account_email_change_requests: { gap: GAP_ACCOUNT },
  candidate_app_preferences: { gap: GAP_ACCOUNT },
  candidate_telegram_usernames: { gap: GAP_ACCOUNT },
  search_consents: { gap: GAP_ACCOUNT },
  candidate_status_changes: { gap: GAP_ACCOUNT },
  candidate_status_signal_answers: { gap: GAP_ACCOUNT },
  b640_offer_choices: { gap: GAP_ACCOUNT },
  application_questionnaires: { gap: GAP_TRACKER },
  application_rejection_reasons: { gap: GAP_TRACKER },
  rejection_review_feedback: { gap: GAP_TRACKER },
  candidate_action_batches: { gap: GAP_TRACKER },
  candidate_action_receipts: { gap: GAP_TRACKER },
  candidate_auto_apply_consents: { gap: GAP_AUTOMATION },
  candidate_auto_apply_journal: { gap: GAP_AUTOMATION },
  candidate_auto_apply_queue: { gap: GAP_AUTOMATION },
  candidate_auto_apply_schedule: { gap: GAP_AUTOMATION },
  candidate_auto_apply_settings: { gap: GAP_AUTOMATION },
  candidate_auto_apply_stops: { gap: GAP_AUTOMATION },
  hh_apply_attempts: { gap: GAP_AUTOMATION },
  hh_raise_schedules: { gap: GAP_AUTOMATION },
  hh_raise_tasks: { gap: GAP_AUTOMATION },
  hh_resume_snapshots: { gap: GAP_AUTOMATION },
  candidate_drafts: { gap: GAP_CONTENT },
  candidate_draft_topic_decisions: { gap: GAP_CONTENT },
  candidate_draft_workflow: { gap: GAP_CONTENT },
  candidate_feed_posts: { gap: GAP_CONTENT },
  text_variants: { gap: GAP_CONTENT },
  candidate_linkedin_offer_variants: { gap: GAP_CONTENT },
  candidate_linkedin_queue: { gap: GAP_CONTENT },
  candidate_linkedin_rhythm: { gap: GAP_CONTENT },
  candidate_linkedin_section_events: { gap: GAP_CONTENT },
  candidate_linkedin_sections: { gap: GAP_CONTENT },
  recruiter_contacts: { gap: GAP_CONTACTS },
  recruiter_contact_channels: { gap: GAP_CONTACTS },
  recruiter_contact_jobs: { gap: GAP_CONTACTS },
  candidate_contact_messages: { gap: GAP_CONTACTS },
  candidate_contact_status: { gap: GAP_CONTACTS },
  candidate_company_wants: { gap: GAP_CAREER },
  candidate_company_proposal_dismissals: { gap: GAP_CAREER },
  candidate_growth_goals: { gap: GAP_CAREER },
  candidate_income: { gap: GAP_CAREER },
  candidate_profession_path: { gap: GAP_CAREER },
  candidate_relocation_places: { gap: GAP_CAREER },
};
