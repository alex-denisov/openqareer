import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_THEMES, MONEY_CURRENCIES } from '../../shared/b640AppPreferences';
import { SqliteAppPreferencesStore } from '../candidate/sqliteAppPreferencesStore';
import { sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

const patchSchema = z
  .object({ theme: z.enum(APP_THEMES).optional(), moneyCurrency: z.enum(MONEY_CURRENCIES).optional() })
  .strict()
  .refine((value) => value.theme !== undefined || value.moneyCurrency !== undefined);

/** B593: тема и валюта показа сумм кандидата — n06 «Приложение»; всё за флагом B640. */
export function registerB640AppPreferencesRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const store = new SqliteAppPreferencesStore({ databasePath: deps.config.databasePath });
  app.addHook('onClose', async () => store.close());
  const url = '/api/v1/candidate/b640/app-preferences';
  const handle = (write: boolean) =>
    withDeps(deps, async (routeDeps, request, reply) => {
      const principal = requireCabinetB640(request, reply, routeDeps);
      if (!principal) return reply;
      const candidate = sessionCandidate(request, reply, principal.candidate);
      if (!candidate) return reply;
      reply.header('Cache-Control', 'no-store');
      if (!write) return { data: store.get(candidate.id), meta: { requestId: request.id } };
      const body = patchSchema.safeParse(request.body);
      if (!body.success) return sendError(reply, request, 400, 'invalid_app_preferences', 'Настройка не сохранилась.', false);
      const data = store.patch(candidate.id, body.data, new Date().toISOString());
      return { data, meta: { requestId: request.id } };
    });
  app.get(url, handle(false));
  app.put(url, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, handle(true));
}
