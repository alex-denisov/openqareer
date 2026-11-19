import type { FastifyInstance } from 'fastify';
import { registerB640ApplicationQuotaRoutes } from './b640ApplicationQuotaRoutes';
import { registerB640ContactRoutes } from './b640ContactRoutes';
import { registerB640HiddenVacancyRoutes } from './b640HiddenVacancyRoutes';
import { registerB640MatchedVacancyRoutes } from './b640MatchedVacancyRoutes';
import { registerB640OwnVacancyRoutes } from './b640OwnVacancyRoutes';
import { registerB640VacancyCardRoutes } from './b640VacancyCardRoutes';
import { registerB640VacancyTriageRoutes } from './b640VacancyTriageRoutes';
import type { RouteDeps } from './deps';

/** B674: три читающих маршрута раздела «Вакансии» кабинета B640; все за флагом. */
export function registerB640VacancyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  registerB640HiddenVacancyRoutes(app, deps);
  registerB640MatchedVacancyRoutes(app, deps);
  registerB640ApplicationQuotaRoutes(app, deps);
  registerB640VacancyTriageRoutes(app, deps);
  registerB640OwnVacancyRoutes(app, deps);
  registerB640VacancyCardRoutes(app, deps);
  registerB640ContactRoutes(app, deps);
}
