import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DELIVERY_FREQUENCIES, type DeliveryFrequency } from '../notifications/deliverySchedule';
import { sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { notificationRepositoryFor } from './notificationRepositoryAccess';

const PATH = '/api/v1/candidate/b640/notifications/preferences/delivery';

const bodySchema = z
  .object({
    frequency: z.enum(DELIVERY_FREQUENCIES as [DeliveryFrequency, ...DeliveryFrequency[]]),
    hideCompany: z.boolean(),
  })
  .strict();

function storageUnavailable(request: FastifyRequest, reply: FastifyReply, candidateId: string, error: unknown) {
  request.log.error(
    {
      code: 'b640_delivery_settings_failed',
      candidateId,
      failureType: error instanceof Error ? error.name : 'UnknownError',
    },
    'b640-delivery-settings-failed',
  );
  return sendError(reply, request, 503, 'notification_storage_unavailable', 'Настройка временно недоступна.', true);
}

/** n02: «Как часто» и «Не показывать название компании»; чтение ничего не пишет. */
async function readDeliverySettings(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  try {
    return { data: notificationRepositoryFor(deps).getDeliverySettings(candidate.id), meta: { requestId: request.id } };
  } catch (error) {
    return storageUnavailable(request, reply, candidate.id, error);
  }
}

async function writeDeliverySettings(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const body = bodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    return sendError(reply, request, 400, 'invalid_preference', 'Проверьте настройку уведомлений.', false);
  }
  try {
    const saved = notificationRepositoryFor(deps).setDeliverySettings(candidate.id, body.data);
    return { data: saved, meta: { requestId: request.id } };
  } catch (error) {
    return storageUnavailable(request, reply, candidate.id, error);
  }
}

export function registerB640DeliverySettingsRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    PATH,
    { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } },
    withDeps(deps, readDeliverySettings),
  );
  app.put(
    PATH,
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, writeDeliverySettings),
  );
}
