import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  LINKEDIN_SECTIONS, LINKEDIN_SECTION_LIMITS,
  type LinkedinProfileView, type LinkedinSection, type LinkedinSectionView,
} from '../../shared/b640LinkedinProfile';
import { LinkedinSectionRepository } from '../linkedinProfile/linkedinSectionRepository';
import { LINKEDIN_REWRITE_BUDGET_MS, rewrittenSuggestions } from '../linkedinProfile/linkedinRewrite';
import { buildSectionSuggestions } from '../linkedinProfile/sectionSuggestions';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';

const BASE = '/api/v1/candidate/b640/linkedin/profile';
const READ_LIMIT = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const WRITE_LIMIT = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

const sectionSchema = z.object({ section: z.enum(LINKEDIN_SECTIONS) });
const markSchema = z.object({}).strict();
const ok = (request: FastifyRequest, data: unknown) => ({ data, meta: { requestId: request.id } });

interface Context { readonly candidateId: string; readonly section?: LinkedinSection }

function context(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply, withSection: boolean): Context | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  if (!withSection) return { candidateId: principal.candidate.id };
  const params = sectionSchema.safeParse(request.params);
  if (!params.success) {
    sendError(reply, request, 400, 'invalid_section', 'Раздел профиля: headline, about, experience или skills.', false);
    return null;
  }
  return { candidateId: principal.candidate.id, section: params.data.section };
}

async function buildView(deps: RouteDeps, repo: LinkedinSectionRepository, candidateId: string): Promise<LinkedinProfileView> {
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const input = { memory: snapshot.memory, draft: snapshot.resume?.draft };
  const current = repo.getCurrent(candidateId);
  // B645: «О себе» и «Опыт» — пересказ моделью; без её принятого ответа предложения по ним нет.
  const suggestions = await rewrittenSuggestions(
    buildSectionSuggestions(input), input, current.get('about')?.text, deps.experienceFactRewriter, LINKEDIN_REWRITE_BUDGET_MS,
  );
  const events = repo.getEvents(candidateId);
  const entries = LINKEDIN_SECTIONS.map((section): [LinkedinSection, LinkedinSectionView] => [section, {
    current: current.get(section) ?? null,
    suggestion: suggestions[section],
    copiedAt: events.get(section)?.copiedAt ?? null,
    pastedAt: events.get(section)?.pastedAt ?? null,
  }]);
  return Object.fromEntries(entries) as LinkedinProfileView;
}

function registerCurrent(app: FastifyInstance, deps: RouteDeps, repo: LinkedinSectionRepository): void {
  app.get(BASE, READ_LIMIT, async (request, reply) => {
    const ctx = context(deps, request, reply, false);
    return ctx ? ok(request, await buildView(deps, repo, ctx.candidateId)) : reply;
  });
  app.put(`${BASE}/:section/current`, WRITE_LIMIT, async (request, reply) => {
    const ctx = context(deps, request, reply, true);
    if (!ctx?.section) return reply;
    const limit = LINKEDIN_SECTION_LIMITS[ctx.section];
    const body = z.object({ text: z.string().trim().min(1).max(limit) }).strict().safeParse(request.body);
    if (!body.success) {
      return sendError(reply, request, 400, 'invalid_section_text', `Вставьте текст раздела, не длиннее ${limit} знаков.`, false);
    }
    return ok(request, repo.setCurrent(ctx.candidateId, ctx.section, body.data.text, 'paste'));
  });
}

function registerMarks(app: FastifyInstance, deps: RouteDeps, repo: LinkedinSectionRepository): void {
  const mark = (suffix: 'copied' | 'pasted', run: (candidateId: string, section: LinkedinSection) => unknown) =>
    app.post(`${BASE}/:section/${suffix}`, WRITE_LIMIT, async (request, reply) => {
      const ctx = context(deps, request, reply, true);
      if (!ctx?.section) return reply;
      if (!markSchema.safeParse(request.body ?? {}).success) {
        return sendError(reply, request, 400, 'invalid_mark', 'Отметка не принимает данных.', false);
      }
      return ok(request, run(ctx.candidateId, ctx.section));
    });
  mark('copied', (candidateId, section) => repo.markCopied(candidateId, section));
  mark('pasted', (candidateId, section) => repo.markPasted(candidateId, section));
}

/**
 * B692: разделы профиля LinkedIn «сейчас» и предложения по ним за флагом `cabinetB640`. Только наше
 * хранение: на LinkedIn ничего не уходит и оттуда ничего не читается. «Сейчас» даёт вставка кандидата;
 * отметку «вставлено» ставит он сам, проверить её нечем.
 */
export function registerB640LinkedinProfileRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const database = deps.candidateActionRepository?.getDatabase();
  if (!database) return;
  const repo = new LinkedinSectionRepository(database);
  registerCurrent(app, deps, repo);
  registerMarks(app, deps, repo);
}
