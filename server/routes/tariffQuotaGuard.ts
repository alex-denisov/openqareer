import type { FastifyReply, FastifyRequest } from 'fastify';
import { quotaExhaustedMessage, type QuotaKey } from '../billing/tariffQuotas';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';

/**
 * B579: списывает единицу квоты до вызова модели. Исчерпанная квота — 402
 * `quota_exhausted` с названием квоты и тарифом, где её больше; это не 429:
 * частоту запросов вошедших не ограничиваем (B557).
 */
export function requireTariffQuota(
  deps: Partial<Pick<RouteDeps, 'config' | 'billingRepository'>>,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  key: QuotaKey,
  unitKey: string,
): boolean {
  if (deps.config?.billingEnforcement !== true || !deps.billingRepository) return true;
  const result = deps.billingRepository.consumeQuota(
    candidateId,
    key,
    unitKey,
    new Date().toISOString(),
  );
  if (result.kind === 'allowed') return true;
  const { status } = result;
  sendError(
    reply,
    request,
    402,
    'quota_exhausted',
    quotaExhaustedMessage(status),
    false,
    undefined,
    {
      quota: status.key,
      label: status.label,
      limit: status.limit,
      used: status.used,
      plan: result.plan,
      upgradePlan: status.upgradePlan,
    },
  );
  return false;
}
