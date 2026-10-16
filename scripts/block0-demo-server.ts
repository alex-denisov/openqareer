/** Local-only native-shell acceptance. No real accounts, credentials or model calls. */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { buildApp } from '../server/app';
import { SqliteCandidateStore } from '../server/data/sqliteCandidateStore';
import type { SessionAuth } from '../server/auth/authService';
import type { ServerConfig } from '../server/config';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 4524,
  previewToken: randomBytes(32).toString('hex'),
  dataEncryptionKey: randomBytes(32),
  databasePath: ':memory:',
  model: 'fixture-disabled',
  staticRoot: path.resolve('dist'),
  release: 'block-0-local-demo',
  logLevel: 'error',
  secureCookies: false,
  allowedOrigins: ['http://127.0.0.1:4524', 'https://openqareer.com'],
  seedAccounts: [],
};
const candidateStore = new SqliteCandidateStore({
  databasePath: ':memory:',
  encryptionKey: config.dataEncryptionKey,
});
const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
const principal = {
  id: 'block0-local',
  username: 'block0.local',
  displayName: 'Локальная проверка',
  email: 'block0@example.test',
  role: 'candidate' as const,
  isTest: true,
  emailVerified: true,
  candidate,
};
const authService: SessionAuth = {
  authenticate: () => principal,
  getAccount: () => ({
    username: principal.username,
    email: principal.email,
    displayName: principal.displayName,
    profile: { headline: null, location: null, workMode: null, updatedAt: null },
    sessions: [],
  }),
  register: async () => {
    throw new Error('Registration is disabled in the local demo.');
  },
  login: async (username, password) =>
    username === 'block0.local' && password === 'local-demo-only'
      ? { principal, sessionToken: candidate.accessToken }
      : null,
  isUsernameTaken: () => false,
  logout() {},
};
const app = await buildApp({
  config,
  candidateStore,
  authService,
  coachProvider: {
    createTurn: async () => {
      throw new Error('Live providers are disabled in the local demo.');
    },
  },
});
app.addHook('onRequest', async (request, reply) => {
  if (request.url === '/') return reply.redirect('/app');
  // This process is bound to loopback and owns a single disposable synthetic candidate.
  request.headers.authorization = `Bearer ${candidate.accessToken}`;
});
app.addHook('onResponse', async (request, reply) => {
  if (request.url.startsWith('/api/'))
    console.log('demo-api', request.method, request.url.split('?')[0], reply.statusCode);
});
app.get('/__block0/state', async () => {
  const workspace = candidateStore.getCandidateWorkspace(candidate.id);
  return {
    workspaceSaved: Boolean(workspace),
    hasGoal: Boolean(workspace?.currentSituation),
    providerCallsEnabled: false,
  };
});
await app.listen({ host: config.host, port: config.port });
console.log(
  'Block 0 local demo: http://127.0.0.1:4524/app (synthetic account, in-memory database).',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
    candidateStore.close();
    process.exit(0);
  });
