import { buildApp } from './app';
import { readServerConfig } from './config';
import { buildCoachProvider } from './providers/coachProviderFactory';
import { PrivacyAwareCoachProvider } from './providers/privacyAwareCoachProvider';
import { CareerOrchestrator } from './orchestration/careerOrchestrator';
import { CoachProviderRoleAgent } from './orchestration/coachProviderRoleAgent';
import { ResilientCoachProvider } from './providers/resilientCoachProvider';
import { selectSyntheticProviderRoutes } from './providers/syntheticProviderRoutes';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { AuthService } from './auth/authService';
import { buildPasswordResetNotifier } from './auth/passwordResetEmail';
import { searchHhVacancies } from './connectors/hhVacancySearch';
import { VacancyIntelligenceService } from './vacancies/vacancyIntelligenceService';

const config = readServerConfig(process.env);
const candidateStore = new SqliteCandidateStore({
  databasePath: config.databasePath,
  encryptionKey: config.dataEncryptionKey,
});
const authService = new AuthService({
  databasePath: config.databasePath,
  ...(config.accountEmail
    ? {
        onPasswordReset: buildPasswordResetNotifier({
          apiKey: config.accountEmail.apiKey,
          from: config.accountEmail.from,
          publicBaseUrl: config.accountEmail.publicBaseUrl,
        }),
      }
    : {}),
});
await authService.seedAccounts(config.seedAccounts, candidateStore);
const personalProviderId = config.personalProvider ?? 'openai';
const syntheticProviderId = config.syntheticProvider ?? 'openrouter';
const personalDataProvider = buildCoachProvider({
  provider: personalProviderId,
  apiKey: config.providerCredentials?.[personalProviderId] ?? '',
  model: config.model,
  folderId: config.yandexFolderId,
});
const syntheticRoutes = selectSyntheticProviderRoutes({
  selectedProvider: syntheticProviderId,
  selectedModel: config.syntheticModel,
  credentials: config.providerCredentials ?? {},
}).map((route) => ({
  id: route.provider,
  provider: buildCoachProvider({
    ...route,
    folderId: config.yandexFolderId,
  }),
}));
const syntheticDataProvider = new ResilientCoachProvider({
  routes: syntheticRoutes,
  maxAttempts: 3,
});
const routedProvider = new PrivacyAwareCoachProvider({
  personalDataProvider,
  syntheticDataProvider,
});
const coachProvider = new CareerOrchestrator({
  roleAgent: new CoachProviderRoleAgent({ provider: routedProvider }),
});
const vacancyIntelligenceService = new VacancyIntelligenceService({
  store: candidateStore,
  connectors: {
    hh: (input) => searchHhVacancies(input, { allowPublicFallback: false }),
  },
  maxBatchSize: 5,
});
const app = await buildApp({
  config,
  coachProvider,
  candidateStore,
  authService,
  vacancyIntelligenceService,
  serveStatic: process.env.NODE_ENV === 'production',
});

let vacancyRefreshTimer: NodeJS.Timeout | undefined;
let documentRetentionTimer: NodeJS.Timeout | undefined;

function runVacancyRefresh(): void {
  void vacancyIntelligenceService
    .runDue()
    .then((result) => {
      if (result.claimed > 0) {
        app.log.info(result, 'vacancy-refresh-completed');
      }
    })
    .catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'vacancy-refresh-failed',
      );
    });
}

function runDocumentRetentionPurge(): void {
  try {
    const purged = candidateStore.purgeExpiredDocuments(
      new Date().toISOString(),
      100,
    );
    if (purged > 0) {
      app.log.info({ purged }, 'document-retention-purge-completed');
    }
  } catch (error) {
    app.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'document-retention-purge-failed',
    );
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutdown-started');
  if (vacancyRefreshTimer) clearInterval(vacancyRefreshTimer);
  if (documentRetentionTimer) clearInterval(documentRetentionTimer);
  await app.close();
  candidateStore.close();
  authService.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  runVacancyRefresh();
  runDocumentRetentionPurge();
  vacancyRefreshTimer = setInterval(runVacancyRefresh, 5 * 60 * 1_000);
  vacancyRefreshTimer.unref();
  documentRetentionTimer = setInterval(
    runDocumentRetentionPurge,
    5 * 60 * 1_000,
  );
  documentRetentionTimer.unref();
} catch (error) {
  app.log.fatal(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'server-start-failed',
  );
  process.exit(1);
}
