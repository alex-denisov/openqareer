import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './deps';
import { requireAdmin } from './adminAuth';
export async function registerBulkLlmSpendRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/admin/llm-spend', async (request, reply) => {
    if (!requireAdmin(deps, request, reply)) return;
    return {
      data: deps.bulkLlmRuntime?.status() ?? {
        enabled: false,
        spentUsd: 0,
        heldUsd: 0,
        remainingUsd: 0,
        limits: null,
        events: [],
      },
      meta: { requestId: request.id },
    };
  });
}
