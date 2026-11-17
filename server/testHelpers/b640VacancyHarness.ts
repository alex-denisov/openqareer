import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { successProvider } from '../appTestHarness';
import { AuthService } from '../auth/authService';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

export interface PoolRow {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly location?: string;
  readonly isRemote?: boolean;
  readonly summary?: string;
  readonly observedAt?: string;
  readonly firstObservedAt?: string;
  readonly salaryFrom?: number;
}

export function poolItem(row: PoolRow): MatchedVacancyItem {
  return {
    cluster: {
      id: row.id,
      canonicalTitle: row.title,
      canonicalCompany: row.company,
      ...(row.location ? { canonicalLocation: row.location } : {}),
      isRemote: row.isRemote ?? false,
      skills: [],
      descriptionSummary: row.summary ?? 'Описание.',
      primaryUrl: `https://example.test/${row.id}`,
      sources: row.observedAt
        ? [{ sourceId: 'src', observedAt: row.observedAt }]
        : [],
      firstObservedAt: row.firstObservedAt ?? '2026-09-01T00:00:00.000Z',
      lastSeenAt: '2026-09-02T00:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
      ...(row.salaryFrom
        ? { salary: { from: row.salaryFrom, to: row.salaryFrom, currency: 'RUR', period: 'month' } }
        : {}),
    },
    explanation: {
      clusterId: row.id,
      roleMatch: 'target',
      requirements: { matched: 1, total: 2 },
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-02T00:00:00.000Z',
    },
  } as unknown as MatchedVacancyItem;
}

export interface HarnessOptions {
  readonly pool: () => MatchedVacancyItem[];
  readonly billing?: boolean;
  /** Журнал сервера по строкам: нужен тестам, которые различают запечатанный ответ и холодный. */
  readonly logLines?: string[];
}

const PASSWORD = 'candidate-password-for-tests';
const USERS = ['flagged.test', 'other.test', 'plain.test'] as const;
export type HarnessUser = (typeof USERS)[number];

/** Приложение с настоящей сессией: два аккаунта с флагом B640 и один без. */
export async function createB640Harness(options: HarnessOptions) {
  const directory = mkdtempSync(join(tmpdir(), 'oq-b640-vac-'));
  const databasePath = join(directory, 'b640.db');
  const candidates = new SqliteCandidateStore({ databasePath, encryptionKey: Buffer.alloc(32, 8) });
  const auth = new AuthService({ databasePath, candidateStore: candidates });
  await auth.seedAccounts(
    USERS.map((username) => ({ username, password: PASSWORD, role: 'candidate' as const })),
    candidates,
  );
  const tokens = {} as Record<HarnessUser, string>;
  const candidateIds = {} as Record<HarnessUser, string>;
  for (const username of USERS) {
    const login = await auth.login(username, PASSWORD);
    if (!login) throw new Error('b640 harness login failed');
    tokens[username] = login.sessionToken;
    const principal = auth.authenticate(login.sessionToken);
    candidateIds[username] = principal?.candidate?.id ?? '';
    candidates.saveResumeDraft(candidateIds[username], { ...EMPTY_RESUME_DRAFT, targetRole: 'Инженер данных' }, []);
  }
  const config = {
    host: '127.0.0.1', port: 3210,
    previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
    dataEncryptionKey: Buffer.alloc(32, 8), databasePath,
    model: 'gpt-5.6-sol', staticRoot: directory, release: 'test', logLevel: options.logLines ? 'info' : 'fatal',
    secureCookies: false, allowedOrigins: ['http://localhost:3000'], seedAccounts: [],
    cabinetB640Usernames: ['flagged.test', 'other.test'],
    ...(options.billing ? { billingEnforcement: true } : {}),
  } as ServerConfig;
  let poolReads = 0;
  let poolHangs = false;
  const engine = {
    getMatchedVacanciesAsync: async () => (poolReads += 1, poolHangs ? new Promise<never>(() => undefined) : options.pool()),
    restore: () => ({ clusters: 0, sources: 0 }),
  };
  const app = await buildApp({
    config, coachProvider: successProvider, candidateStore: candidates, authService: auth,
    multiSourceVacancyEngine: engine as never, serveStatic: false,
    ...(options.logLines ? { logDestination: { write: (line: string) => { options.logLines?.push(line); } } } : {}),
  });
  const get = (url: string, user?: HarnessUser) =>
    app.inject({ method: 'GET', url, headers: user ? { authorization: `Bearer ${tokens[user]}` } : {} });
  const post = (url: string, payload: unknown, user?: HarnessUser) =>
    app.inject({ method: 'POST', url, payload: payload as object, headers: user ? { authorization: `Bearer ${tokens[user]}` } : {} });
  const close = async () => {
    await app.close(); auth.close(); candidates.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return { app, get, post, candidates, candidateIds, tokens, databasePath, poolReads: () => poolReads, hangPool: (hangs: boolean) => { poolHangs = hangs; }, close };
}
