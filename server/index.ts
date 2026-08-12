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

const config = readServerConfig(process.env);
const candidateStore = new SqliteCandidateStore({
  databasePath: config.databasePath,
  encryptionKey: config.dataEncryptionKey,
});
const authService = new AuthService({
  databasePath: config.databasePath,
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
const app = await buildApp({
  config,
  coachProvider,
  candidateStore,
  authService,
  serveStatic: process.env.NODE_ENV === 'production',
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutdown-started');
  await app.close();
  candidateStore.close();
  authService.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'server-start-failed',
  );
  process.exit(1);
}
