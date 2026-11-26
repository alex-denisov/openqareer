import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  GOAL_HINTS_PROMPT_REVISION,
  GOAL_INDICATOR_MAX,
  GOAL_ROLE_MAX,
  type BaselineEntry,
  type GoalBaseline,
  type GoalExample,
} from '../domain/goalHints';
import { buildGoalHints, type GoalHints } from '../providers/goalHintModel';
import { roleTitleRu } from '../vacancies/roleTitleRu';
import { readCampaign } from './campaignContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B744: подсказки формы цели «Дневника» под флагом B640.
 * - POST goal-examples {role} — три примера целей под роль (d02c). Вход — только роль.
 * - GET role-title-ru?title= — русское название роли для текста d02c (онтология и свои
 *   названия кампании, как на «Карьере»); модель не зовётся, ничего не пишется.
 * - POST goal-baseline {indicator} — значение «Сейчас» из записей кандидата с цитатой (d02b).
 * Ответы держатся в памяти процесса по входу: повтор не зовёт модель. Провал модели — не
 * ошибка, а «подсказки нет»: экран остаётся как без неё.
 */
export type GoalHintRouteDeps = RouteDeps & { readonly goalHints?: GoalHints };

const ROOT = '/api/v1/candidate/career-diary';
const ENTRIES = 40;
const TEXT_CHARS = 400;
const CACHE_MAX = 500;

const roleSchema = z.object({ role: z.string().trim().min(1).max(GOAL_ROLE_MAX) });
const titleSchema = z.object({ title: z.string().trim().min(1).max(GOAL_ROLE_MAX) });
const CYRILLIC = /[а-яё]/iu;
const indicatorSchema = z.object({
  indicator: z.string().trim().min(2).max(GOAL_INDICATOR_MAX),
});

/** Память ответов с вытеснением самых старых: процесс живёт до выката, а не вечно. */
class AnswerCache<T> {
  private readonly items = new Map<string, T>();
  get(key: string): T | undefined {
    return this.items.get(key);
  }
  set(key: string, value: T): void {
    this.items.delete(key);
    this.items.set(key, value);
    const oldest = this.items.keys().next();
    if (this.items.size > CACHE_MAX && !oldest.done) this.items.delete(oldest.value);
  }
}

const hashOf = (parts: readonly unknown[]): string =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');

function candidateId(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const invalid = (reply: FastifyReply, request: FastifyRequest) =>
  sendError(reply, request, 400, 'validation_error', 'Проверьте поле.', false);

function recentEntries(deps: RouteDeps, candidate: string): BaselineEntry[] {
  return deps.candidateStore.diaryEntryRepo
    .list(candidate, ENTRIES)
    .items.map((entry) => ({
      id: entry.id,
      date: entry.date,
      text: entry.text.trim().slice(0, TEXT_CHARS),
    }))
    .filter((entry) => entry.text !== '');
}

/** Русское название роли без модели и без записи: онтология и свои названия кампании. */
function registerRoleTitleRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    `${ROOT}/role-title-ru`,
    withDeps(deps, async (bound, request, reply) => {
      const candidate = candidateId(bound, request, reply);
      if (!candidate) return undefined;
      const query = titleSchema.safeParse(request.query);
      if (!query.success) return invalid(reply, request);
      const title = query.data.title;
      const own = readCampaign(bound.candidateStore, candidate).ownTitlesRu;
      const named = roleTitleRu(title, own);
      // Русского нет — `null`: клиент оставляет название как есть.
      const titleRu = named !== title || CYRILLIC.test(title) ? named : null;
      return { data: { titleRu }, meta: { requestId: request.id } };
    }),
  );
}

export function registerCareerDiaryGoalHintRoutes(
  app: FastifyInstance,
  deps: GoalHintRouteDeps,
): void {
  const hints =
    deps.goalHints ?? buildGoalHints({ providerCredentials: deps.config.providerCredentials });
  const examples = new AnswerCache<readonly GoalExample[] | null>();
  const baselines = new AnswerCache<GoalBaseline | null>();

  app.post(
    `${ROOT}/goal-examples`,
    withDeps(deps, async (bound, request, reply) => {
      if (!candidateId(bound, request, reply)) return undefined;
      const body = roleSchema.safeParse(request.body);
      if (!body.success) return invalid(reply, request);
      const key = hashOf([GOAL_HINTS_PROMPT_REVISION, body.data.role.toLowerCase()]);
      const known = examples.get(key);
      const items = known !== undefined ? known : ((await hints?.examples(body.data.role)) ?? null);
      // Провал модели не запоминается: следующий заход спросит снова.
      if (known === undefined && items !== null) examples.set(key, items);
      return { data: items ? { items } : null, meta: { requestId: request.id } };
    }),
  );

  registerRoleTitleRoute(app, deps);

  app.post(
    `${ROOT}/goal-baseline`,
    withDeps(deps, async (bound, request, reply) => {
      const candidate = candidateId(bound, request, reply);
      if (!candidate) return undefined;
      const body = indicatorSchema.safeParse(request.body);
      if (!body.success) return invalid(reply, request);
      const entries = recentEntries(bound, candidate);
      // Записей нет — искать негде: модель не зовётся.
      if (entries.length === 0) return { data: null, meta: { requestId: request.id } };
      const indicator = body.data.indicator;
      const key = hashOf([GOAL_HINTS_PROMPT_REVISION, candidate, indicator.toLowerCase(), entries]);
      const known = baselines.get(key);
      const found = known !== undefined ? known : await hints?.baseline(indicator, entries);
      if (known === undefined && found !== undefined) baselines.set(key, found);
      return { data: found ?? null, meta: { requestId: request.id } };
    }),
  );
}
