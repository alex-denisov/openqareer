import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { config, noSessions, successProvider } from '../appTestHarness';

describe('matched vacancies timing log (C44)', () => {
  it('writes one privacy-safe structured timing record for the first request', async () => {
    const lines: string[] = [];
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    candidateStore.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole: 'CTO' }, []);
    const app = await buildApp({
      config: { ...config, logLevel: 'info' },
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      serveStatic: false,
      logDestination: { write: (line) => lines.push(line) },
    });
    try {
      const response = await app.inject({
        url: '/api/v1/candidate/matched-vacancies',
        headers: { authorization: `Bearer ${candidate.accessToken}` },
      });
      expect(response.statusCode).toBe(200);
      const timing = lines.map((line) => JSON.parse(line)).find((line) => line.msg === 'matched-vacancies-timing');
      expect(timing).toMatchObject({
        mode: 'legacy',
        cold: true,
        candidateCampaignMs: expect.any(Number),
        semanticQueryAndSqlMs: expect.any(Number),
        clusterJsonAndClustersMs: expect.any(Number),
        titleParseAndLevelsMs: expect.any(Number),
        pageAndExplanationsMs: expect.any(Number),
        enrichmentsMs: expect.any(Number),
      });
      expect(JSON.stringify(timing)).not.toContain(candidate.id);
      expect(JSON.stringify(timing)).not.toContain(candidate.accessToken);
    } finally {
      await app.close();
      candidateStore.close();
    }
  });
});
