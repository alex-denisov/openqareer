import { registerReportedSeoBotObservability } from './observability/reportedSeoBots';
import { SqliteMarketSalaryEstimateStore } from './vacancies/marketSalary/sqliteMarketSalaryEstimateStore';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
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
import type { CoverLetterWriter } from './providers/coverLetterWriter';
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
import { registerDesktopDownloadRoutes } from './routes/desktopDownloadRoutes';
import { registerErrorHandler, registerStaticDelivery } from './routes/runtime';
import { SqliteRecruiterContactsRepository } from './data/sqliteRecruiterContactsRepository';
import { SqliteCandidateReputationRepository } from './data/sqliteCandidateReputationRepository';
import { SqliteSearchConsentRepository } from './data/sqliteSearchConsentRepository';
import { SqliteCapabilityConsentStore } from './auth/capabilityConsentStore';
import { SqliteNetworkIndexRepository } from './data/sqliteNetworkIndexRepository';
import { SqliteReferralRequestRepository } from './data/sqliteReferralRequestRepository';
import { registerReputationAuditRoutes } from './routes/reputationAuditRoutes';
import { registerCandidateFootprintRoutes } from './routes/candidateFootprintRoutes';
import { registerSearchConsentRoutes } from './routes/searchConsentRoutes';
import { registerCapabilityConsentRoutes } from './routes/capabilityConsentRoutes';
import { SqliteCandidateActionRepository } from './candidate/sqliteCandidateActionRepository';
import { CandidateActionExecutor } from './candidate/candidateActionExecutor';
import { registerCandidateActionRoutes } from './routes/candidateActionRoutes';
import {
  registerCandidateDraftRoutes,
  type CandidateDraftRouteDeps,
} from './routes/candidateDraftRoutes';
import { SqliteCandidateDraftRepository } from './candidate/sqliteCandidateDraftRepository';
import {
  buildLinkedinDraftWriter,
  type LinkedinDraftWriter,
} from './providers/linkedinDraftWriter';
import { SqliteTitleParseStore } from './vacancies/titleParse/sqliteTitleParseStore';
import { SqliteCandidateCompanyWantsRepository } from './data/sqliteCandidateCompanyWantsRepository';
import { registerCandidateCompanyRoutes } from './routes/candidateCompanyRoutes';
import type { RobokassaGateway } from './billing/robokassaGateway';
import { SqliteBillingRepository } from './billing/sqliteBillingRepository';
import { registerBillingRoutes } from './billing/billingRoutes';
import { registerQuotaRoutes } from './billing/quotaRoutes';
import { installRateLimitPolicy } from './routes/rateLimitPolicy';
import { authenticateSession } from './routes/helpers';
import { createRobokassaGateway } from './billing/robokassaProtocol';
import { runDueBillingRenewals } from './billing/renewalRunner';
import { sendBillingRenewalReminder } from './billing/billingReminderEmail';

import { createBulkLlmRuntime } from './providers/bulkLlmRuntime';
import { currentVacancyFitProfileValidator } from './domain/vacancyFitProfileStamp';
import { VacancyMechanicsRuntime } from './domain/vacancyMechanicsRuntime';
import { registerVacancyFitRoutes } from './routes/vacancyFitRoutes';
import { registerBulkLlmSpendRoutes } from './routes/bulkLlmSpendRoutes';
import { storedHhVacancySample } from './vacancies/storedHhVacancySample';

interface BuildAppOptions {
  bulkLlmRuntime?: RouteDeps['bulkLlmRuntime'];
  config: ServerConfig;
  coachProvider: CoachProvider;
  candidateStore: CandidateStore;
  authService: SessionAuth;
  robokassaGateway?: RobokassaGateway;
  billingRepository?: SqliteBillingRepository;
  serveStatic?: boolean;
  searchVacancies?: (input: { text: string; perPage?: number }) => Promise<HhVacancySample>;
  /** Срез из собственного обхода hh; по умолчанию — пул движка вакансий (29.10). */
  searchStoredVacancies?: (input: { text: string; perPage?: number }) => Promise<HhVacancySample>;
  searchRemotive?: (input: { text: string; perPage?: number }) => Promise<VacancySample>;
  importProfile?: (url: string) => Promise<ProfileUrlImportResult>;
  careerCommandExecutor?: ConnectorExecutor;
  vacancyIntelligenceService?: VacancyIntelligenceService;
  multiSourceVacancyEngine?: MultiSourceVacancyEngine;
  hhCrawlSettings?: import('./vacancies/hhCrawlSettings').HhCrawlSettingsStore;
  /** Память и пауза опросов — админский маршрут, сторож памяти (B220). */
  runtimeMemory?: RouteDeps['runtimeMemory'];
  /** Absent when no provider credential is configured; the rules parser runs alone. */
  resumeStructurer?: ResumeStructurer;
  experienceFactRewriter?: RouteDeps['experienceFactRewriter'];
  roleNamer?: RoleNamer;
  campaignRoleModel?: RouteDeps['campaignRoleModel'];
  /** Вопросы квиза по навыку профиля (блок A, пакет 3); нет ключей — квиза нет. */
  skillQuizModel?: RouteDeps['skillQuizModel'];
  coverLetterWriter?: CoverLetterWriter;
  linkedinDraftWriter?: LinkedinDraftWriter;
  candidateDraftRepository?: SqliteCandidateDraftRepository;
  /** Инъекция нужна тестам; в runtime стор открывает общую базу пула. */
  titleParseStore?: SqliteTitleParseStore;
  recruiterContactsRepo?: SqliteRecruiterContactsRepository;
  candidateReputationRepo?: SqliteCandidateReputationRepository;
  searchConsentRepo?: SqliteSearchConsentRepository;
  capabilityConsentStore?: SqliteCapabilityConsentStore;
  candidateCompanyWantsRepo?: SqliteCandidateCompanyWantsRepository;
  networkIndexRepo?: SqliteNetworkIndexRepository;
  referralRequestRepo?: SqliteReferralRequestRepository;
  candidateActionRepository?: SqliteCandidateActionRepository;
  candidateActionExecutor?: CandidateActionExecutor;
  linkedinPool?: import('./linkedinPool/sqliteLinkedinPoolRepository').SqliteLinkedinPoolRepository;
  linkedinRemoteLogin?: RouteDeps['linkedinRemoteLogin'];
  matchedPoolPrecompute?: RouteDeps['matchedPoolPrecompute'];
  vacancyDemand?: RouteDeps['vacancyDemand'];
  /** B546: tests inject estimates; runtime reads the table maintenance writes. */
  marketSalaryEstimates?: RouteDeps['marketSalaryEstimates'];

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
  titleParseStore: SqliteTitleParseStore;
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
    | 'titleParseStore'
  >,
): AppServices {
  const { candidateStore } = options;
  const careerCommandDispatcher = new CareerCommandDispatcher({
    store: candidateStore,
    executor: options.careerCommandExecutor,
  });
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
    titleParseStore:
      options.titleParseStore ??
      new SqliteTitleParseStore({ databasePath: options.config.databasePath }),
  };
}

function loggerOptions(
  config: ServerConfig,
  logDestination?: { write(line: string): void },
): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: config.logLevel,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.url'],
      censor: (value, path) =>
        path.join('.') === 'req.url' ? redactRequestUrlForLogs(value) : '[REDACTED]',
    },
    ...(logDestination ? { stream: logDestination } : {}),
  };
}

export function redactRequestUrlForLogs(value: unknown): string {
  if (typeof value !== 'string') return '[REDACTED]';
  try {
    const url = new URL(value, 'http://localhost');
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (
        ['token', 'code', 'secret', 'password'].includes(normalized) ||
        normalized.endsWith('_token')
      ) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return '[REDACTED]';
  }
}

/** B557: вошедший — действующая сессия или токен кандидата; лимиты частоты его не касаются. */
function signedInCheck(
  config: ServerConfig,
  authService: SessionAuth,
  candidateStore: CandidateStore,
): (request: FastifyRequest) => boolean {
  return (request) => {
    const authorization = request.headers.authorization ?? '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    return (
      (bearer !== '' && candidateStore.authenticate(bearer) !== null) ||
      authenticateSession(request, authService, config) !== null
    );
  };
}

async function registerRateLimits(
  app: FastifyInstance,
  isSignedIn: (request: FastifyRequest) => boolean,
): Promise<void> {
  installRateLimitPolicy(app, { isSignedIn });
  await app.register(rateLimit, { global: false, keyGenerator: (request) => request.ip });
}

async function createFastifyBase(
  config: ServerConfig,
  isSignedIn: (request: FastifyRequest) => boolean,
  logDestination?: { write(line: string): void },
): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: '127.0.0.1',
    logger: loggerOptions(config, logDestination),
    bodyLimit: 256 * 1_024,
    requestTimeout: 190_000,
    // Id кластера — ключ источника с полным адресом вакансии (130+ символов);
    // порог Fastify по умолчанию (100) отвечал 414 на отклик и контакты (PRB-041).
    maxParamLength: 2_048,
  });

  registerReportedSeoBotObservability(app);
  await app.register(cookie);
  await registerRateLimits(app, isSignedIn);
  registerBillingFormParser(app);

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept, X-Requested-With, X-OpenQareer-Device-Id',
      );
    }
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  app.addHook('onSend', async (request, reply) => {
    // Cached media (B265 §4) is the one deliberate exception: a candidate's
    // own photo/logo is content-addressed by `mediaId` and safe to keep in
    // the browser cache for a day, unlike every other candidate-scoped API
    // response here.
    if (request.url.startsWith('/api/') && !request.url.startsWith('/api/v1/candidate/media/')) {
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
    },
  }));

  return app;
}

function registerBillingFormParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, new URLSearchParams(body.toString())),
  );
}

async function registerApiRoutes(
  app: FastifyInstance,
  deps: CandidateDraftRouteDeps,
): Promise<void> {
  await registerAdminRoutes(app, deps);
  await registerBulkLlmSpendRoutes(app, deps);
  await registerVacancyFitRoutes(app, deps);
  await registerAuthRoutes(app, deps);
  await registerConnectorRoutes(app, deps);
  await registerCandidateRoutes(app, deps);
  await registerVacancyRoutes(app, deps);
  await registerCoachRoutes(app, deps);
  await registerCareerCommandRoutes(app, deps);
  await registerCompanyRoutes(app);
  // Публичный каталог вакансий: без сессии, HTML собирается на запросе (B209).
  registerVacancyCatalogRoutes(app, deps);
  registerDesktopDownloadRoutes(app, deps);
  registerReputationAuditRoutes(app, deps);
  registerCandidateFootprintRoutes(app, deps);
  registerSearchConsentRoutes(app, deps);
  registerCandidateCompanyRoutes(app, deps);
  registerCapabilityConsentRoutes(app, deps);
  registerCandidateActionRoutes(app, deps);
  registerCandidateDraftRoutes(app, deps);
  registerBillingRoutes(app, deps);
  registerQuotaRoutes(app, deps);
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

/** Репозитории кандидата: переданные снаружи или созданные на базе сервера. */
function createCandidateRepositories(options: BuildAppOptions) {
  const { config } = options;
  return {
    recruiterContactsRepo:
      options.recruiterContactsRepo ??
      new SqliteRecruiterContactsRepository({ databasePath: config.databasePath }),
    candidateReputationRepo:
      options.candidateReputationRepo ??
      new SqliteCandidateReputationRepository({
        databasePath: config.databasePath,
        encryptionKey: config.dataEncryptionKey,
      }),
    searchConsentRepo:
      options.searchConsentRepo ??
      new SqliteSearchConsentRepository({ databasePath: config.databasePath }),
    capabilityConsentStore:
      options.capabilityConsentStore ??
      new SqliteCapabilityConsentStore({ databasePath: config.databasePath }),
    networkIndexRepo:
      options.networkIndexRepo ??
      new SqliteNetworkIndexRepository({ databasePath: config.databasePath }),
    referralRequestRepo:
      options.referralRequestRepo ??
      new SqliteReferralRequestRepository({ databasePath: config.databasePath }),
    candidateCompanyWantsRepo:
      options.candidateCompanyWantsRepo ??
      new SqliteCandidateCompanyWantsRepository({
        databasePath: config.databasePath,
        encryptionKey: config.dataEncryptionKey,
      }),
    candidateActionRepository:
      options.candidateActionRepository ??
      new SqliteCandidateActionRepository({ databasePath: config.databasePath }),
  };
}

function storedSampleOf(services: AppServices): RouteDeps['searchStoredVacancies'] {
  return (input) => storedHhVacancySample(services.multiSourceEngine, input);
}

function assembleRouteDeps(
  options: BuildAppOptions,
  services: AppServices,
): CandidateDraftRouteDeps {
  const {
    config,
    authService,
    candidateStore,
    coachProvider,
    importProfile = importPublicProfileUrl,
    resumeStructurer,
    roleNamer,
    campaignRoleModel,
    coverLetterWriter,
    linkedinPool,
    searchVacancies = searchHhVacancies,
    hhCrawlSettings,
    runtimeMemory,
    matchedPoolPrecompute,
  } = options;

  return {
    config,
    authService,
    candidateStore,
    uploadStaging: createUploadStaging(),
    coachProvider,
    ...createBillingRouteDependencies(options, config),
    importProfile,
    resumeStructurer,
    roleNamer,
    campaignRoleModel,
    coverLetterWriter,
    ...createCandidateRepositories(options),
    ...createCandidateDraftDeps(options),
    ...(options.candidateActionExecutor
      ? { candidateActionExecutor: options.candidateActionExecutor }
      : {}),
    ...(options.billingRepository ? { billingRepository: options.billingRepository } : {}),
    ...(linkedinPool ? { linkedinPool } : {}),
    ...(options.linkedinRemoteLogin ? { linkedinRemoteLogin: options.linkedinRemoteLogin } : {}),
    roleNamingFailures: new RoleNamingFailureLog(),

    searchVacancies,
    searchStoredVacancies: options.searchStoredVacancies ?? storedSampleOf(services),
    ...(hhCrawlSettings ? { hhCrawlSettings } : {}),
    ...(runtimeMemory ? { runtimeMemory } : {}),
    ...(matchedPoolPrecompute ? { matchedPoolPrecompute } : {}),
    ...(options.vacancyDemand ? { vacancyDemand: options.vacancyDemand } : {}),
    ...services,
  };
}

function createBillingRouteDependencies(
  options: BuildAppOptions,
  config: ServerConfig,
): Pick<RouteDeps, 'robokassaGateway' | 'billingRepository'> {
  const robokassaGateway = options.robokassaGateway
    ?? (config.robokassa?.recurringApproved ? createRobokassaGateway(config.robokassa) : undefined);
  const billingRepository = options.billingRepository
    ?? (config.databasePath === ':memory:'
      ? undefined
      : new SqliteBillingRepository({ databasePath: config.databasePath }));
  return {
    ...(robokassaGateway ? { robokassaGateway } : {}),
    ...(billingRepository ? { billingRepository } : {}),
  };
}

function registerBillingRenewalScheduler(
  app: FastifyInstance,
  config: ServerConfig,
  deps: Pick<RouteDeps, 'billingRepository' | 'robokassaGateway'>,
): () => void {
  const repository = deps.billingRepository;
  const gateway = deps.robokassaGateway;
  if (config.billingEnforcement !== true || !config.robokassa?.recurringApproved || !repository || !gateway) {
    return () => undefined;
  }
  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;
  const run = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await runDueBillingRenewals({
        repository,
        gateway,
        emailVerificationRequired: config.emailVerificationRequired,
        ...(config.accountEmail
          ? { sendReminder: (reminder) => sendBillingRenewalReminder(config.accountEmail!, reminder) }
          : {}),
      });
      if (Object.values(result).some((count) => count > 0)) app.log.info(result, 'billing_renewal_run_completed');
    } catch (error) {
      app.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'billing_renewal_run_failed');
    } finally {
      inFlight = false;
    }
  };
  app.addHook('onReady', async () => {
    void run();
    timer = setInterval(() => void run(), 60_000);
    timer.unref();
  });
  return () => { if (timer) clearInterval(timer); };
}

function createCandidateDraftDeps(
  options: BuildAppOptions,
): Pick<
  CandidateDraftRouteDeps,
  'candidateDraftRepository' | 'linkedinDraftWriter' | 'skillQuizModel' | 'experienceFactRewriter'
> {
  const { config } = options;
  return {
    skillQuizModel: options.skillQuizModel,
    experienceFactRewriter: options.experienceFactRewriter,
    candidateDraftRepository:
      options.candidateDraftRepository ??
      new SqliteCandidateDraftRepository({ databasePath: config.databasePath }),
    linkedinDraftWriter:
      options.linkedinDraftWriter ??
      buildLinkedinDraftWriter({
        providerCredentials: config.providerCredentials,
        vertex: config.vertex,
      }),
  };
}

/** B546: the web server only reads estimates the maintenance process wrote. */
function attachMarketSalaryStore(
  deps: { marketSalaryEstimates?: RouteDeps['marketSalaryEstimates'] },
  options: BuildAppOptions,
): SqliteMarketSalaryEstimateStore | undefined {
  const owned = options.marketSalaryEstimates
    ? undefined
    : new SqliteMarketSalaryEstimateStore({ databasePath: options.config.databasePath });
  deps.marketSalaryEstimates = options.marketSalaryEstimates ?? owned;
  return owned;
}

/** Repositories the app opened itself; ones passed in belong to the caller (tests). */
function closeOwnedCandidateRepos(
  options: Pick<
    BuildAppOptions,
    'candidateCompanyWantsRepo' | 'networkIndexRepo' | 'referralRequestRepo'
  >,
  deps: Pick<RouteDeps, 'candidateCompanyWantsRepo' | 'networkIndexRepo' | 'referralRequestRepo'>,
): void {
  if (!options.candidateCompanyWantsRepo) deps.candidateCompanyWantsRepo?.close();
  if (!options.networkIndexRepo) deps.networkIndexRepo?.close();
  if (!options.referralRequestRepo) deps.referralRequestRepo?.close();
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const {
    config,
    candidateStore,
    authService,
    serveStatic = true,
    searchVacancies = searchHhVacancies,
    searchRemotive = searchRemotiveVacancies,
    careerCommandExecutor,
    vacancyIntelligenceService,
    multiSourceVacancyEngine,
    logDestination,
  } = options;
  attachCandidateStore(authService, candidateStore);
  const services = createServices({
    config,
    candidateStore,
    careerCommandExecutor,
    vacancyIntelligenceService,
    multiSourceVacancyEngine,
    searchVacancies,
    searchRemotive,
    titleParseStore: options.titleParseStore,
  });
  const deps = assembleRouteDeps(options, services);
  deps.vacancyMechanics = new VacancyMechanicsRuntime(config.databasePath, config.dataEncryptionKey, currentVacancyFitProfileValidator(candidateStore));
  deps.bulkLlmRuntime =
    options.bulkLlmRuntime ?? createBulkLlmRuntime({ databasePath: config.databasePath });
  const ownedMarketSalaryEstimates = attachMarketSalaryStore(deps, options);
  const isSignedIn = signedInCheck(config, deps.authService, candidateStore);
  const app = await createFastifyBase(config, isSignedIn, logDestination);
  const stopBillingScheduler = registerBillingRenewalScheduler(app, config, deps);
  app.addHook('onClose', () => {
    stopBillingScheduler();
    deps.vacancyMechanics?.close();
    if (!options.bulkLlmRuntime) deps.bulkLlmRuntime?.close();
    services.titleParseStore.close();
    ownedMarketSalaryEstimates?.close();
    deps.capabilityConsentStore?.close();
    closeOwnedCandidateRepos(options, deps);
    if (!options.candidateDraftRepository) deps.candidateDraftRepository.close();
    if (!options.billingRepository && config.databasePath !== ':memory:') {
      deps.billingRepository?.close();
    }
  });
  await registerApiRoutes(app, deps);
  registerErrorHandler(app);
  await registerStaticDelivery(app, config, serveStatic, signedInCheck(config, deps.authService, deps.candidateStore));
  return app;
}
