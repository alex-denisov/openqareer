import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SqliteRelocationPlacesRepository } from '../candidate/sqliteRelocationPlacesRepository';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import {
  placesSchema,
  RUSSIAN_CITIES,
  russianCityRows,
  type RussianCityRow,
} from '../domain/relocationPlaces';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { csrfError, hasSafeMutationOrigin, sendError, withDeps } from './helpers';

/**
 * B672 «Релокация»: выбранные места (страны и города России) между визитами и
 * разделы трат «Не про меня». Без флага B640 адреса отвечают как
 * несуществующие; прежние маршруты релокации не меняются.
 */
type BoundDeps = RouteDeps & { readonly places: SqliteRelocationPlacesRepository };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const EMPTY_PLACES = { saved: false, places: [], updatedAt: null } as const;
const CITIES_TTL_MS = 15 * 60 * 1000;
const citiesCache = new Map<string, { readonly at: number; readonly rows: RussianCityRow[] }>();

function candidateOf(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const getPlaces: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  // Чтение ничего не пишет: без согласия список не показывается, а удаляется он
  // в транзакции отзыва согласия (SqliteRelocationQuestionnaireRepository).
  const granted = deps.candidateStore.relocationQuestionnaireRepo.getConsent(candidateId).granted;
  const data = granted ? deps.places.read(candidateId) : EMPTY_PLACES;
  return { data, meta: { requestId: request.id } };
};

const putPlaces: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const parsed = placesSchema.safeParse(request.body);
  if (!parsed.success)
    return sendError(reply, request, 400, 'invalid_places', 'Проверьте список мест.', false);
  if (!deps.candidateStore.relocationQuestionnaireRepo.getConsent(candidateId).granted)
    return sendError(
      reply,
      request,
      403,
      'relocation_consent_required',
      'Подтвердите согласие на данные о переезде перед сохранением.',
      false,
    );
  const data = deps.places.replace(candidateId, parsed.data.places, new Date().toISOString());
  return { data, meta: { requestId: request.id } };
};

function readCityCounts(databasePath: string): RussianCityRow[] {
  const cached = citiesCache.get(databasePath);
  if (cached && Date.now() - cached.at < CITIES_TTL_MS) return cached.rows;
  if (!existsSync(databasePath)) return [];
  const slugs = [...RUSSIAN_CITIES.keys()];
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const table = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_entries'")
      .get();
    if (!table) return [];
    const counts = database
      .prepare(
        `SELECT place_slug AS slug, count(*) AS count FROM catalog_entries
          WHERE status = 'active' AND path <> '' AND place_slug IN (${slugs.map(() => '?').join(',')})
          GROUP BY place_slug`,
      )
      .all(...slugs) as { slug: string; count: number }[];
    const rows = russianCityRows(counts);
    citiesCache.set(databasePath, { at: Date.now(), rows });
    return rows;
  } finally {
    database.close();
  }
}

const getCities: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  try {
    const cities = readCityCounts(deps.config.databasePath);
    return { data: { cities }, meta: { requestId: request.id } };
  } catch (error) {
    request.log.warn({ err: error }, 'relocation-cities-unreadable');
    return sendError(reply, request, 503, 'cities_unavailable', 'Города не прочитались.', true);
  }
};

export function registerRelocationPlacesRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const database = new DatabaseSync(deps.config.databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  applySqliteBusyTimeout(database);
  app.addHook('onClose', async () => database.close());
  const bound: BoundDeps = { ...deps, places: new SqliteRelocationPlacesRepository(database) };
  const limit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const path = '/api/v1/candidate/career/relocation';
  app.get(`${path}/places`, limit, withDeps(bound, getPlaces));
  app.put(`${path}/places`, { ...limit, bodyLimit: 8192 }, withDeps(bound, putPlaces));
  app.get(`${path}/cities`, limit, withDeps(bound, getCities));
}
