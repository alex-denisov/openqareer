import { buildApp } from './app';
import { readServerConfig } from './config';
import { OpenAICoachProvider } from './providers/openAICoachProvider';
import { OpenRouterCoachProvider } from './providers/openRouterCoachProvider';
import { PrivacyAwareCoachProvider } from './providers/privacyAwareCoachProvider';

const config = readServerConfig(process.env);
const personalDataProvider = new OpenAICoachProvider({
  apiKey: config.openAIKey,
  model: config.model,
});
const syntheticDataProvider = new OpenRouterCoachProvider({
  apiKey: config.openRouterKey,
});
const coachProvider = new PrivacyAwareCoachProvider({
  personalDataProvider,
  syntheticDataProvider,
});
const app = await buildApp({
  config,
  coachProvider,
  serveStatic: process.env.NODE_ENV === 'production',
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutdown-started');
  await app.close();
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
