import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import type { ResumeCandidateInput } from '../domain/resumeDraft';
import { SmmAgent } from './smmAgent';
import { SmmBot } from './smmBot';
import { createSmmModel } from './smmModel';
import { SmmStore } from './smmStore';
import { createSmmTelegram } from './smmTelegram';

const TICK_MS = 5 * 60_000;
const BRIEF_TTL_MS = 60 * 60_000;
const BRIEF_MAX_CHARS = 2_500;
const DEFAULT_OWNER_USERNAME = 'adenisov.test';
const CHAT_ID_PATTERN = /^-?\d{1,20}$/;
const TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/;

export interface SmmRuntimeConfig {
  readonly token: string;
  readonly chatId: string;
  readonly openRouterKey?: string;
  readonly geminiKey?: string;
  readonly ownerUsername: string;
  readonly autopost: boolean;
}

/** Бот включается только с токеном и чатом SMM; чат владельца для оповещений — другой. */
export function readSmmConfig(env: NodeJS.ProcessEnv): SmmRuntimeConfig | null {
  const token = env.OPENQAREER_TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const chatId = env.OPENQAREER_SMM_CHAT_ID?.trim() ?? '';
  if (!TOKEN_PATTERN.test(token) || !CHAT_ID_PATTERN.test(chatId)) return null;
  return {
    token,
    chatId,
    openRouterKey: env.OPENQAREER_OPENROUTER_API_KEY?.trim() || undefined,
    geminiKey: env.OPENQAREER_GEMINI_API_KEY?.trim() || undefined,
    ownerUsername: env.OPENQAREER_SMM_OWNER_USERNAME?.trim() || DEFAULT_OWNER_USERNAME,
    autopost: env.OPENQAREER_SMM_AUTOPOST === '1',
  };
}

/** Факты профиля владельца на платформе — только то, что он сам туда положил. */
export function ownerBriefFrom(resume: ResumeCandidateInput | null): string {
  if (!resume) return '';
  const lines = [
    resume.fullName ? `Имя: ${resume.fullName}` : '',
    resume.headline ? `Заголовок: ${resume.headline}` : '',
    resume.about ? `О себе: ${resume.about}` : '',
  ].filter(Boolean);
  return lines.join('\n').slice(0, BRIEF_MAX_CHARS);
}

export interface SmmRuntimeDeps {
  readonly databasePath: string;
  readonly config: SmmRuntimeConfig;
  readonly getResumeCandidate: (candidateId: string) => ResumeCandidateInput | null;
  readonly log: (event: string, detail?: Record<string, unknown>) => void;
}

/** Бриф владельца из его профиля; перечитывается раз в час. */
function cachedOwnerBrief(database: DatabaseSync, deps: SmmRuntimeDeps): () => string {
  let brief = { text: '', at: 0 };
  return (): string => {
    if (Date.now() - brief.at < BRIEF_TTL_MS) return brief.text;
    try {
      const row = database
        .prepare('SELECT candidate_id FROM users WHERE username = ?')
        .get(deps.config.ownerUsername) as { candidate_id: string | null } | undefined;
      brief = {
        text: row?.candidate_id ? ownerBriefFrom(deps.getResumeCandidate(row.candidate_id)) : '',
        at: Date.now(),
      };
    } catch (error) {
      deps.log('smm-owner-brief-failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      brief = { text: '', at: Date.now() };
    }
    return brief.text;
  };
}

export function startSmmAssistant(deps: SmmRuntimeDeps): () => void {
  const database = new DatabaseSync(deps.databasePath);
  database.exec('PRAGMA journal_mode = WAL;');
  applySqliteBusyTimeout(database);
  const store = new SmmStore(database);
  const ownerBrief = cachedOwnerBrief(database, deps);
  const model = createSmmModel({
    openRouterKey: deps.config.openRouterKey,
    geminiKey: deps.config.geminiKey,
    log: (event, detail) => deps.log(event, detail),
  });
  const agent = new SmmAgent({ store, model, ownerBrief, now: Date.now });
  const bot = new SmmBot({
    autopost: deps.config.autopost,
    store,
    agent,
    telegram: createSmmTelegram(deps.config.token),
    chatId: deps.config.chatId,
    now: Date.now,
    log: deps.log,
  });
  void bot.poll();
  const timer = setInterval(() => {
    bot
      .tick()
      .catch((error: unknown) =>
        deps.log('smm-tick-failed', { error: error instanceof Error ? error.name : 'unknown' }),
      );
  }, TICK_MS);
  timer.unref();
  deps.log('smm-assistant-started');
  return () => {
    clearInterval(timer);
    bot.stop();
  };
}
