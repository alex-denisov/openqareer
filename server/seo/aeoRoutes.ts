import type { FastifyInstance } from 'fastify';
import { buildLlmsFullTxt, buildLlmsTxt } from '../../shared/aeoSurface';
import { getLandingStats } from '../landing/landingStatsCache';

/** Public aggregate evidence only. Reads the same prepared snapshot as the landing. */
export function registerAeoRoutes(app: FastifyInstance): void {
  for (const [path, build] of [
    ['/llms.txt', buildLlmsTxt],
    ['/llms-full.txt', buildLlmsFullTxt],
  ] as const) {
    app.get(path, async (_request, reply) =>
      reply
        .header('Cache-Control', 'public, max-age=300')
        .type('text/markdown; charset=utf-8')
        .send(build(getLandingStats())),
    );
  }
}
