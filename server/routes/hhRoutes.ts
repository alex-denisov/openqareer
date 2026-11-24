import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { SqliteApplyConsentJournal } from '../candidate/sqliteApplyConsentJournal';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import type { RouteDeps } from './deps';
import { registerHhResumeVariantRoutes } from './hhResumeVariantRoutes';
import { registerApplyConsentRoutes } from './applyConsentRoutes';
import { registerHhSessionRoutes } from './hhSessionRoutes';

/** Сессия hh.ru кандидата, журнал согласий по откликам и варианты правок его резюме. */
export function registerHhRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const database = new DatabaseSync(deps.config.databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  applySqliteBusyTimeout(database);
  app.addHook('onClose', async () => database.close());
  const journal = new SqliteApplyConsentJournal(database, deps.config.dataEncryptionKey);
  registerHhSessionRoutes(app, { ...deps, journal });
  registerApplyConsentRoutes(app, { ...deps, journal });
  registerHhResumeVariantRoutes(app, deps);
}
