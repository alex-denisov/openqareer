import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { ServerConfig } from './config';
import type { CandidateStore } from './data/candidateStore';
import type { HhVacancySample } from './connectors/hhVacancySearch';
import { searchHhVacancies } from './connectors/hhVacancySearch';
import { searchRemotiveVacancies } from './connectors/remotiveVacancySearch';
import {
  importProfileUrl as importPublicProfileUrl,
  type ProfileUrlImportResult,
} from './connectors/profileUrlImport';
import { CareerCommandDispatcher } from './orchestration/careerCommandDispatcher';
import type { ConnectorExecutor } from './connectors/connectorHarness';
import type { CoachProvider } from './providers/coachProvider';
import type { ResumeStructurer } from './providers/resumeStructurer';
import type { RoleNamer } from './providers/roleNamer';
import { RoleNamingFailureLog } from './providers/roleNamingFailureLog';
import type { SessionAuth } from './auth/authService';
import type { VacancySample } from './domain/vacancy';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import { VacancyIntelligenceService } from './vacancies/vacancyIntelligenceService';
import { buildMultiSourceFetcher } from './vacancies/multiSourceFetcher';
import type { RouteDeps } from './routes/deps';
import { UploadStaging } from './data/uploadStaging';
import { DOCUMENT_MAX_BYTES } from '../shared/fileLimits';
import { registerAdminRoutes } from './routes/adminRoutes';
import { registerAuthRoutes } from './routes/authRoutes';
import { registerCandidateRoutes } from './routes/candidateRoutes';
import { registerCareerCommandRoutes } from './routes/careerCommandRoutes';
import { registerCoachRoutes } from './routes/coachRoutes';
import { registerConnectorRoutes } from './routes/connectorRoutes';
import { registerVacancyRoutes } from './routes/vacancyRoutes';
import { registerCompanyRoutes } from './routes/companiesRoute';
import { registerVacancyCatalogRoutes } from './routes/vacancyCatalogRoutes';
import { registerErrorHandler, registerStaticDelivery } from './routes/runtime';

interface BuildAppOptions {
  config: ServerConfig;
  coachProvider: CoachProvider;
  candidateStore: CandidateStore;
  authService: SessionAuth;
  serveStatic?: boolean;
  searchVacancies?: (input: { text: string; perPage?: number }) => Promise<HhVacancySample>;
  searchRemotive?: (input: { text: string; perPage?: number }) => Promise<VacancySample>;
  importProfile?: (url: string) => Promise<ProfileUrlImportResult>;
  careerCommandExecutor?: ConnectorExecutor;
  vacancyIntelligenceService?: VacancyIntelligenceService;
  multiSourceVacancyEngine?: MultiSourceVacancyEngine;
  hhCrawlSettings?: import('./vacancies/hhCrawlSettings').HhCrawlSettingsStore;
  /** Память и пауза опросов для `/api/v1/health` — сторож памяти (B220). */
  runtimeMemory?: () => {
    readonly ingestPaused: boolean;
    readonly heapUsedMb: number;
    readonly heapLimitMb: number;
    readonly poolSize: number;
  };
  /** Absent when no provider credential is configured; the rules parser runs alone. */
  resumeStructurer?: ResumeStructurer;
  roleNamer?: RoleNamer;
  /**
   * Куда пишет логгер. Прод пишет в stdout, а тест читает то же самое, что
   * увидит оператор: причина молчания ступени называния — часть контракта
   * (INC-035, B186).
   */
  logDestination?: { write(line: string): void };
}

interface AppServices {
  careerCommandDispatcher: CareerCommandDispatcher | null;
  vacancyIntelligence: VacancyIntelligenceService;
  multiSourceEngine: MultiSourceVacancyEngine;
}

function createServices(
  options: Pick<
    BuildAppOptions,
    | 'config'
    | 'candidateStore'
    | 'careerCommandExecutor'
    | 'vacancyIntelligenceService'
    | 'multiSourceVacancyEngine'
    | 'searchVacancies'
    | 'searchRemotive'
  >,
): AppServices {
  const { candidateStore } = options;
  const careerCommandDispatcher = options.careerCommandExecutor
    ? new CareerCommandDispatcher({
        store: candidateStore,
        executor: options.careerCommandExecutor,
      })
    : null;
  const vacancyIntelligence =
    options.vacancyIntelligenceService ??
    new VacancyIntelligenceService({
      store: candidateStore,
      connectors: {
        hh: options.searchVacancies,
        remotive: options.searchRemotive,
      },
    });
  return {
    careerCommandDispatcher,
    vacancyIntelligence,
    multiSourceEngine:
      options.multiSourceVacancyEngine ??
      new MultiSourceVacancyEngine({
        fetcher: buildMultiSourceFetcher(
          options.searchVacancies ?? searchHhVacancies,
          options.searchRemotive ?? searchRemotiveVacancies,
        ),
      }),
  };
}

function loggerOptions(
  config: ServerConfig,
  logDestination?: { write(line: string): void },
): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: config.logLevel,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[REDACTED]',
    },
    ...(logDestination ? { stream: logDestination } : {}),
  };
}

async function createFastifyBase(
  config: ServerConfig,
  logDestination?: { write(line: string): void },
  runtimeMemory?: BuildAppOptions['runtimeMemory'],
): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: '127.0.0.1',
    logger: loggerOptions(config, logDestination),
    bodyLimit: 256 * 1_024,
    requestTimeout: 190_000,
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => request.ip,
  });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept, X-Requested-With',
      );
    }
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
    }
  });

  app.get('/health', async (_request, reply) => {
    reply.type('text/plain').header('Cache-Control', 'no-store');
    return config.release;
  });

  app.get('/api/v1/health', async () => ({
    data: {
      status: 'ok',
      release: config.release,
      // Память и пауза опросов видны снаружи: остановка пула — не тишина, а
      // названный факт с цифрой (B220).
      ...(runtimeMemory ? { memory: runtimeMemory() } : {}),
    },
  }));

  return app;
}

async function registerApiRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  await registerAdminRoutes(app, deps);
  await registerAuthRoutes(app, deps);
  await registerConnectorRoutes(app, deps);
  await registerCandidateRoutes(app, deps);
  await registerVacancyRoutes(app, deps);
  await registerCoachRoutes(app, deps);
  await registerCareerCommandRoutes(app, deps);
  await registerCompanyRoutes(app);
  // Публичный каталог вакансий: без сессии, HTML собирается на запросе (B209).
  registerVacancyCatalogRoutes(app, deps);
}

/** Аутентификация части реализаций читает кандидатов из того же хранилища. */
function attachCandidateStore(authService: SessionAuth, candidateStore: CandidateStore): void {
  if (authService && 'setCandidateStore' in authService) {
    (authService as { setCandidateStore(s: CandidateStore): void }).setCandidateStore(
      candidateStore,
    );
  }
}

/**
 * Части файла живут только до сборки документа: незаконченная загрузка —
 * это не документ кандидата (INC-031).
 */
function createUploadStaging(): UploadStaging {
  return new UploadStaging({
    maxBytes: Math.ceil(DOCUMENT_MAX_BYTES * 1.4),
    ttlMs: 10 * 60_000,
  });
}

export async function buildApp({
  config,
  coachProvider,
  candidateStore,
  authService,
  serveStatic = true,
  hhCrawlSettings,
  runtimeMemory,
  searchVacancies = searchHhVacancies,
  searchRemotive = searchRemotiveVacancies,
  importProfile = importPublicProfileUrl,
  careerCommandExecutor,
  vacancyIntelligenceService,
  multiSourceVacancyEngine,
  resumeStructurer,
  roleNamer,
  logDestination,
}: BuildAppOptions): Promise<FastifyInstance> {
  attachCandidateStore(authService, candidateStore);
  const services = createServices({
    config,
    candidateStore,
    careerCommandExecutor,
    vacancyIntelligenceService,
    multiSourceVacancyEngine,
    searchVacancies: searchVacancies ?? searchHhVacancies,
    searchRemotive: searchRemotive ?? searchRemotiveVacancies,
  });
  const deps: RouteDeps = {
    config,
    authService,
    candidateStore,
    uploadStaging: createUploadStaging(),
    coachProvider,
    importProfile,
    resumeStructurer,
    roleNamer,
    // Окно живёт столько же, сколько процесс: это диагностика молчания
    // ступени, а не хранилище (INC-035).
    roleNamingFailures: new RoleNamingFailureLog(),
    searchVacancies: searchVacancies ?? searchHhVacancies,
    ...(hhCrawlSettings ? { hhCrawlSettings } : {}),
    ...services,
  };
  const app = await createFastifyBase(config, logDestination, runtimeMemory);
  await registerApiRoutes(app, deps);
  registerErrorHandler(app);
  await registerStaticDelivery(app, config, serveStatic);
  return app;
}
