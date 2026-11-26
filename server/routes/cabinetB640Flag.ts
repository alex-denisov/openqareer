import type { FastifyReply, FastifyRequest } from 'fastify';
import { cabinetB640Enabled } from '../auth/cabinetB640Access';
import type { AuthPrincipal } from '../auth/authTypes';
import type { RouteDeps } from './deps';
import {
  authenticateSession,
  csrfError,
  hasSafeMutationOrigin,
  requireVerifiedEmail,
} from './helpers';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * B649: общая проверка флага нового кабинета для маршрутов и фоновых задач
 * волны 3. Фоновая задача зовёт `cabinetB640Enabled(config, username)` и не
 * берёт кандидата без флага; маршрут начинается с `requireCabinetB640`.
 */
export { cabinetB640Enabled, cabinetB640Features } from '../auth/cabinetB640Access';
export type { CabinetFeatures } from '../auth/authTypes';

/**
 * Ворота нового маршрута. Без сессии и без флага отвечает так же, как
 * несуществующий адрес, поэтому маршрут нельзя отличить от отсутствующего.
 * Аккаунту с флагом дальше нужны подтверждённый email и, для изменяющих
 * запросов, свой источник страницы: маршруту не нужно помнить об этом самому.
 * Вернул `null` — ответ уже отправлен, обработчик возвращает `reply`.
 */
export function requireCabinetB640(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: Pick<RouteDeps, 'authService' | 'config'>,
): AuthPrincipal | null {
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal || !cabinetB640Enabled(deps.config, principal.username)) {
    reply.callNotFound();
    return null;
  }
  if (!READ_METHODS.has(request.method) && !hasSafeMutationOrigin(request, deps.config)) {
    csrfError(request, reply);
    return null;
  }
  if (!requireVerifiedEmail(request, reply, principal)) return null;
  return principal;
}
