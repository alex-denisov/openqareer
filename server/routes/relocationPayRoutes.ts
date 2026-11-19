import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { latinCityName } from '../../shared/placeNames';
import { getCountryTaxData } from '../../shared/taxData';
import { getCurrencyRates } from '../currency/cbrRates';
import { cityPay, countryPay, type StoredStats } from '../domain/relocationPay';
import { RELOCATION_PAY_COUNTRIES } from '../domain/relocationPlaces';
import { salaryStatsKey } from '../vacancies/catalogSalaryStatsStore';
import { catalogRoleOf } from '../vacancies/vacancyCatalogFacets';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { loadCountryCatalog } from './salaryMarketRoutes';

/**
 * B653 C06 «Релокация»: вилка страны или города России для строки места.
 * Только чтение готовых расчётов каталога; без флага B640 адрес отвечает как
 * несуществующий. Сохранение мест — relocationPlacesRoutes (B672).
 */
type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const querySchema = z.union([
  z.object({ country: z.string().regex(/^[A-Z]{2}$/u) }).strict(),
  z
    .object({
      city: z.string().trim().min(1).max(80),
      role: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
]);

function readStats(databasePath: string, keys: readonly string[]): (StoredStats | null)[] {
  if (!existsSync(databasePath)) return keys.map(() => null);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const table = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_salary_stats'")
      .get();
    if (!table) return keys.map(() => null);
    const select = database.prepare(
      'SELECT payload, computed_at FROM catalog_salary_stats WHERE list_key = ?',
    );
    return keys.map((key) => {
      const row = select.get(key) as { payload: string; computed_at: string } | undefined;
      if (!row) return null;
      try {
        return { stats: JSON.parse(row.payload), computedAt: row.computed_at } as StoredStats;
      } catch {
        return null;
      }
    });
  } finally {
    database.close();
  }
}

function readCityPay(deps: RouteDeps, city: string, role: string | undefined) {
  const place = latinCityName(city);
  if (!place) return { state: 'thin' } as const;
  const roleSlug = role ? catalogRoleOf({ title: role })?.slug : undefined;
  const keys = [
    ...(roleSlug ? [salaryStatsKey({ place, role: roleSlug })] : []),
    salaryStatsKey({ place }),
  ];
  const stats = readStats(deps.config.databasePath, keys);
  return roleSlug ? cityPay(stats[0] ?? null, stats[1] ?? null) : cityPay(null, stats[0] ?? null);
}

function readCountryCatalog(deps: RouteDeps, request: FastifyRequest, code: string) {
  try {
    return loadCountryCatalog(deps.config.databasePath, code);
  } catch (error) {
    // Каталог ещё не собран или занят: строка страны скажет «мало данных».
    request.log.warn({ err: error, code }, 'relocation-pay-country-catalog-unreadable');
    return null;
  }
}

const getPay: Handler = async (deps, request, reply) => {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  if (!principal.candidate)
    return sendError(
      reply,
      request,
      401,
      'unauthorized',
      'Нужна действующая сессия кандидата.',
      false,
    );
  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success)
    return sendError(reply, request, 400, 'invalid_place', 'Укажите страну или город.', false);
  if ('city' in parsed.data) {
    const data = readCityPay(deps, parsed.data.city, parsed.data.role);
    return { data, meta: { requestId: request.id } };
  }
  const code = parsed.data.country;
  if (!RELOCATION_PAY_COUNTRIES.includes(code))
    return sendError(reply, request, 404, 'unknown_country', 'По этой стране расчёта нет.', false);
  const catalog = readCountryCatalog(deps, request, code);
  const data = countryPay(catalog, getCountryTaxData(code).currency, getCurrencyRates());
  return { data, meta: { requestId: request.id } };
};

export function registerRelocationPayRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const limit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  app.get('/api/v1/candidate/career/relocation/pay', limit, withDeps(deps, getPay));
}
