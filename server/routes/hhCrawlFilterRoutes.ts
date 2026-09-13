import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HH_ROLE_CATEGORIES, keepKnownRoleIds } from '../vacancies/hhRoleCatalog';
import type { HhCrawlSettingsStore } from '../vacancies/hhCrawlSettings';

/**
 * Фильтр веера обхода hh.ru для суперадминки (B214).
 *
 * Владелец выбирает роли множественным выбором из полного справочника
 * площадки — 27 категорий, 304 роли, — а не правит код. По умолчанию выбрана
 * категория «Информационные технологии».
 *
 * Роль, которой площадка не знает, не сохраняется **и называется отдельно**:
 * молча выбросить её значит оставить владельца в уверенности, что он собирает
 * то, чего обход не спрашивает.
 */

const filterSchema = z.object({
  roleIds: z.array(z.string().min(1).max(16)).max(400),
  searchPeriodDays: z.number().int().min(1).max(30),
});

export interface HhCrawlFilterRouteDeps {
  readonly settings: HhCrawlSettingsStore;
  readonly requireAdmin: (request: FastifyRequest, reply: FastifyReply) => unknown;
  readonly sendError: (
    reply: FastifyReply,
    request: FastifyRequest,
    status: number,
    code: string,
    message: string,
    retryable: boolean,
  ) => unknown;
}

function handleRead(deps: HhCrawlFilterRouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.requireAdmin(request, reply)) return;
    const settings = deps.settings.read();
    return {
      data: {
        categories: HH_ROLE_CATEGORIES,
        selectedRoleIds: settings.roleIds,
        searchPeriodDays: settings.searchPeriodDays,
        lastFullSweepAt: settings.lastFullSweepAt ?? null,
      },
      meta: { requestId: request.id },
    };
  };
}

function handleWrite(deps: HhCrawlFilterRouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.requireAdmin(request, reply)) return;

    const parsed = filterSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return deps.sendError(
        reply,
        request,
        422,
        'hh_crawl_filter_invalid',
        'Проверьте набор ролей и срок: срок от 1 до 30 дней.',
        false,
      );
    }

    const known = keepKnownRoleIds(parsed.data.roleIds);
    const ignored = parsed.data.roleIds.filter((id) => !known.includes(id));

    // Пустой набор — это не «собирать всё», а «не собирать ничего».
    if (known.length === 0) {
      return deps.sendError(
        reply,
        request,
        422,
        'hh_crawl_roles_empty',
        'Выберите хотя бы одну роль: пустой набор остановил бы обход целиком.',
        false,
      );
    }

    deps.settings.saveRoles(known, parsed.data.searchPeriodDays);
    const saved = deps.settings.read();
    return {
      data: {
        selectedRoleIds: saved.roleIds,
        searchPeriodDays: saved.searchPeriodDays,
        ignoredRoleIds: ignored,
      },
      meta: { requestId: request.id },
    };
  };
}

/**
 * Глубокий обход по требованию. Нужен, когда пул надо пересобрать сейчас, а не
 * ждать двадцати часов: например, после того как обход был чем-то нарушен.
 */
function handleRequestSweep(deps: HhCrawlFilterRouteDeps) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.requireAdmin(request, reply)) return;
    deps.settings.requestFullSweep();
    return {
      data: { lastFullSweepAt: deps.settings.read().lastFullSweepAt ?? null },
      meta: { requestId: request.id },
    };
  };
}

export function registerHhCrawlFilterRoutes(
  app: FastifyInstance,
  deps: HhCrawlFilterRouteDeps,
): void {
  app.get('/api/v1/admin/hh-crawl-filter', handleRead(deps));
  app.put('/api/v1/admin/hh-crawl-filter', handleWrite(deps));
  app.post('/api/v1/admin/hh-crawl-filter/deep-sweep', handleRequestSweep(deps));
}
