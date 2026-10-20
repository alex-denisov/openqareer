import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { createInterviewSession } from '../domain/interviewSimulator';
import type { RouteDeps } from './deps';
import { registerInterviewDiaryRoutes } from './interviewDiaryRoutes';

describe('B465 interview diary HTTP contract', () => {
  it('saves server evidence once, isolates tenants, supports pagination and deletion', async () => {
    const store = new SqliteCandidateStore({ databasePath: ':memory:', encryptionKey: Buffer.alloc(32, 23) });
    const first = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const second = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const app = Fastify();
    await app.register(cookie);
    registerInterviewDiaryRoutes(app, { candidateStore: store, config: { secureCookies: false, allowedOrigins: ['http://localhost:3000'] }, authService: { authenticate: () => null } } as unknown as RouteDeps);
    const headers = { authorization: `Bearer ${first.accessToken}` };
    const other = { authorization: `Bearer ${second.accessToken}` };
    const base = '/api/v1/candidate/career-diary/interview-practices';
    const session = createInterviewSession({ id: 'session-one', roleTitle: 'Engineer', mode: 'text', applicationId: null, questionTypes: ['behavioral'], stressMode: false, stories: [], questionIds: ['q1','q2','q3','q4','q5'], now: '2026-10-19T10:00:00.000Z' });
    store.interviewSimulatorRepo.create(first.id, session, session.startedAt);
    try {
      expect((await app.inject({ method: 'PUT', url: `${base}/${session.id}`, headers: other })).statusCode).toBe(404);
      const saved = await app.inject({ method: 'PUT', url: `${base}/${session.id}`, headers });
      expect(saved.statusCode).toBe(201);
      expect(saved.json().data.session.id).toBe(session.id);
      expect(saved.json().data.source).toBe('mock_interview');
      expect((await app.inject({ method: 'PUT', url: `${base}/${session.id}`, headers, payload: { session: { roleTitle: 'Forged' } } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'PUT', url: `${base}/${session.id}`, headers: { origin: 'https://attacker.invalid' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: base })).statusCode).toBe(401);
      expect((await app.inject({ method: 'PUT', url: `${base}/${session.id}`, headers })).json().data).toEqual(saved.json().data);
      expect((await app.inject({ method: 'GET', url: `${base}?limit=1`, headers })).json().data.items).toHaveLength(1);
      expect((await app.inject({ method: 'GET', url: base, headers: other })).json().data.items).toHaveLength(0);
      expect((await app.inject({ method: 'GET', url: `${base}?limit=0`, headers })).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: `${base}?cursor=invalid`, headers })).statusCode).toBe(400);
      store.interviewSimulatorRepo.update(first.id, session.id, session.version, { ...session, roleTitle: 'Engineer revised' }, '2026-10-19T11:00:00.000Z');
      const updated = (await app.inject({ method: 'PUT', url: `${base}/${session.id}`, headers })).json().data;
      expect(updated.id).toBe(saved.json().data.id);
      expect(updated.createdAt).toBe(saved.json().data.createdAt);
      expect(updated.session.version).toBe(session.version + 1);
      expect(updated.session.roleTitle).toBe('Engineer revised');
      const secondSession = { ...session, id: 'session-two' };
      store.careerDiaryRepo.saveInterviewPractice(first.id, secondSession);
      const firstPage = (await app.inject({ method: 'GET', url: `${base}?limit=1`, headers })).json().data;
      expect(firstPage.nextCursor).toBeTruthy();
      const secondPage = (await app.inject({ method: 'GET', url: `${base}?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`, headers })).json().data;
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
      expect((await app.inject({ method: 'DELETE', url: `${base}/${session.id}`, headers: other })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: `${base}/${session.id}`, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `${base}/${session.id}`, headers })).statusCode).toBe(404);
      expect(store.exportCandidate(first.id).interviewPractices.map(record => record.id)).toEqual(['session-two']);
      expect(store.exportCandidate(second.id).interviewPractices).toEqual([]);
      store.deleteCandidate(first.id);
      expect(store.careerDiaryRepo.listInterviewPractices(first.id, 20).items).toHaveLength(0);
    } finally { await app.close(); store.close(); }
  });
});
