import type { FastifyInstance } from 'fastify';
import { registerB640ApplicationQuotaRoutes } from './b640ApplicationQuotaRoutes';
import { registerB640HiddenVacancyRoutes } from './b640HiddenVacancyRoutes';
import { registerB640MatchedVacancyRoutes } from './b640MatchedVacancyRoutes';
import type { RouteDeps } from './deps';

/** B674: три читающих маршрута раздела «Вакансии» кабинета B640; все за флагом. */
export function registerB640VacancyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  registerB640HiddenVacancyRoutes(app, deps);
  registerB640MatchedVacancyRoutes(app, deps);
  registerB640ApplicationQuotaRoutes(app, deps);
}
