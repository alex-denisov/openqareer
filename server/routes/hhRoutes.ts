import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './deps';
import { registerHhResumeVariantRoutes } from './hhResumeVariantRoutes';
import { registerHhSessionRoutes } from './hhSessionRoutes';

/** Сессия hh.ru кандидата и варианты правок его резюме. */
export function registerHhRoutes(app: FastifyInstance, deps: RouteDeps): void {
  registerHhSessionRoutes(app, deps);
  registerHhResumeVariantRoutes(app, deps);
}
