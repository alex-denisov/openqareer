import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApplicationStage } from '../../shared/applicationStage';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function setup() {
  const h = await createB640Harness({ pool: () => [] });
  closers.push(h.close);
  const send = (
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    user?: HarnessUser,
    payload?: unknown,
  ) =>
    h.app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: {
        ...(user ? { authorization: `Bearer ${h.tokens[user]}` } : {}),
        origin: 'http://localhost:3000',
      },
    });
  const application = (user: HarnessUser, stage: ApplicationStage, n = randomUUID()) =>
    h.candidates.createApplication(h.candidateIds[user], {
      stage,
      manualVacancy: {
        title: 'CTO',
        company: `Co ${n}`,
        url: `https://example.test/${n}`,
        source: 'other',
      },
    });
  const offer = (user: HarnessUser, respondBy: string | null = null) => {
    const app = application(user, 'offer');
    h.candidates.putApplicationOffer(
      h.candidateIds[user],
      app.id,
      { baseSalary: 200000, salaryPeriod: 'month', currency: 'RUB' },
      respondBy,
    );
    return app;
  };
  const queueAuto = (user: HarnessUser, applicationId: string, status = 'sent') => {
    const database = new DatabaseSync(h.databasePath);
    database
      .prepare(
        `INSERT INTO candidate_auto_apply_queue
         (id, candidate_id, cluster_id, application_id, platform, status, send_timing, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'hh', ?, 'today', 'x', ?, ?)`,
      )
      .run(randomUUID(), h.candidateIds[user], randomUUID(), applicationId, status, 'now', 'now');
    database.close();
  };
  return { ...h, send, application, offer, queueAuto };
}

describe('B640 offer routes: flag', () => {
  it('answers 404 on every new route without the flag or a session', async () => {
    const { send, offer } = await setup();
    const own = offer('plain.test');
    const urls: Array<['GET' | 'PUT', string, unknown?]> = [
      ['GET', `${BASE}/responses/summary`],
      ['GET', `${BASE}/offers`],
      ['PUT', `${BASE}/offers/${own.id}/tax`, { taxPercent: 13 }],
      ['PUT', `${BASE}/offers/${own.id}/decision`, { decision: 'accepted' }],
    ];
    for (const [method, url, body] of urls) {
      expect((await send(method, url, 'plain.test', body)).statusCode).toBe(404);
      expect((await send(method, url, undefined, body)).statusCode).toBe(404);
    }
  });

  it('leaves old offer routes and funnel unchanged', async () => {
    const { send, offer, candidateIds } = await setup();
    const own = offer('plain.test', '2026-12-01');
    await send('PUT', `${BASE}/offers/${own.id}/tax`, 'plain.test', { taxPercent: 13 });
    const old = await send('GET', `/api/v1/candidate/applications/${own.id}/offer`, 'plain.test');
    expect(old.statusCode).toBe(200);
    expect(old.json().data).toMatchObject({ applicationId: own.id, respondBy: '2026-12-01' });
    expect(JSON.stringify(old.json())).not.toContain('taxPercent');
    expect(
      (await send('GET', '/api/v1/candidate/applications/funnel', 'plain.test')).statusCode,
    ).toBe(200);
    expect(candidateIds['plain.test']).toBeTruthy();
  });
});

describe('B640 offer routes: responses summary', () => {
  it('counts auto and manual responses by current stage, ignoring removed queue rows', async () => {
    const { send, application, queueAuto } = await setup();
    const a = application('flagged.test', 'applied');
    application('flagged.test', 'applied');
    const removed = application('flagged.test', 'interview');
    application('other.test', 'applied');
    queueAuto('flagged.test', a.id);
    queueAuto('flagged.test', removed.id, 'removed');
    const response = await send('GET', `${BASE}/responses/summary`, 'flagged.test');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { data, meta } = response.json();
    expect(meta.requestId).toBeTruthy();
    expect(data.counts.all).toMatchObject({ applied: 2, interview: 1 });
    expect(data.counts.auto).toMatchObject({ applied: 1, interview: 0 });
    expect(data.counts.manual).toMatchObject({ applied: 1, interview: 1 });
    expect(data.autoApplicationIds).toEqual([a.id]);
  });

  it('lists drafts whose letter is approved, only for own live applications', async () => {
    const { send, application, candidates, candidateIds } = await setup();
    const approve = (user: 'flagged.test' | 'other.test', applicationId: string) =>
      candidates.saveDocumentAndLinkApplicationMaterial(candidateIds[user], applicationId, 'cover_letter', {
        kind: 'cover_letter',
        source: 'generated',
        fileName: `approved-letter-${randomUUID()}.json`,
        mimeType: 'application/json',
        contentBase64: Buffer.from(
          JSON.stringify({ vacancyId: 'v1', applicationId, approvedAt: '2026-11-19T08:00:00Z', body: 'Текст' }),
          'utf8',
        ).toString('base64'),
        extractedText: 'Текст',
        parseStatus: 'not_applicable',
      });
    const approved = application('flagged.test', 'saved');
    application('flagged.test', 'saved');
    approve('flagged.test', approved.id);
    approve('other.test', application('other.test', 'saved').id);
    const data = (await send('GET', `${BASE}/responses/summary`, 'flagged.test')).json().data;
    expect(data.approvedLetterIds).toEqual([approved.id]);
  });

  it('a response taken off the auto queue counts as manual', async () => {
    const { send, application, queueAuto } = await setup();
    const a = application('flagged.test', 'applied');
    queueAuto('flagged.test', a.id, 'removed');
    const data = (await send('GET', `${BASE}/responses/summary`, 'flagged.test')).json().data;
    expect(data.autoApplicationIds).toEqual([]);
    expect(data.counts.manual).toMatchObject({ applied: 1 });
  });
});

describe('B640 offer routes: offers, tax, decision', () => {
  it('lists only own applications that have an offer, with deadline state', async () => {
    const { send, offer, application } = await setup();
    const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const mine = offer('flagged.test', day);
    offer('other.test');
    application('flagged.test', 'applied');
    const response = await send('GET', `${BASE}/offers`, 'flagged.test');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const data = response.json().data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      applicationId: mine.id,
      gross: { amount: 200000, period: 'month', currency: 'RUB' },
      taxPercent: null,
      net: null,
      daysLeft: 1,
      deadline: 'soon',
      decision: null,
    });
  });

  it('recalculates net from the entered tax and clears it with null', async () => {
    const { send, offer } = await setup();
    const own = offer('flagged.test');
    const url = `${BASE}/offers/${own.id}/tax`;
    const set = await send('PUT', url, 'flagged.test', { taxPercent: 13 });
    expect(set.statusCode).toBe(200);
    expect(set.json().data).toMatchObject({ taxPercent: 13, net: 174000 });
    const listed = (await send('GET', `${BASE}/offers`, 'flagged.test')).json().data[0];
    expect(listed).toMatchObject({ taxPercent: 13, net: 174000 });
    const cleared = await send('PUT', url, 'flagged.test', { taxPercent: null });
    expect(cleared.json().data).toMatchObject({ taxPercent: null, net: null });
  });

  it('validates the tax body', async () => {
    const { send, offer } = await setup();
    const url = `${BASE}/offers/${offer('flagged.test').id}/tax`;
    for (const body of [
      { taxPercent: -1 },
      { taxPercent: 61 },
      { taxPercent: '13' },
      {},
      { taxPercent: 5, x: 1 },
    ]) {
      expect((await send('PUT', url, 'flagged.test', body)).statusCode).toBe(400);
    }
  });

  it('stores the decision and proposes working only on acceptance', async () => {
    const { send, offer } = await setup();
    const own = offer('flagged.test');
    const url = `${BASE}/offers/${own.id}/decision`;
    const accepted = await send('PUT', url, 'flagged.test', { decision: 'accepted' });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data.proposeStatus).toBe('working');
    expect(accepted.json().data.offer).toMatchObject({ decision: 'accepted' });
    expect(accepted.json().data.offer.decidedAt).toBeTruthy();
    const declined = await send('PUT', url, 'flagged.test', { decision: 'declined' });
    expect(declined.json().data).toMatchObject({
      proposeStatus: null,
      offer: { decision: 'declined' },
    });
    expect((await send('GET', `${BASE}/offers`, 'flagged.test')).json().data[0].decision).toBe(
      'declined',
    );
    expect((await send('PUT', url, 'flagged.test', { decision: 'maybe' })).statusCode).toBe(400);
  });

  it('clears the decision back to «Думаю» with decision null (B658)', async () => {
    const { send, offer } = await setup();
    const own = offer('flagged.test');
    const url = `${BASE}/offers/${own.id}/decision`;
    await send('PUT', url, 'flagged.test', { decision: 'accepted' });
    const cleared = await send('PUT', url, 'flagged.test', { decision: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data).toMatchObject({
      proposeStatus: null,
      offer: { decision: null, decidedAt: null },
    });
  });

  it('does not propose working when the status is already working, and changes nothing itself', async () => {
    const { send, offer, application } = await setup();
    const own = offer('flagged.test');
    await send('PUT', '/api/v1/candidate/status', 'flagged.test', { status: 'working' });
    const result = await send('PUT', `${BASE}/offers/${own.id}/decision`, 'flagged.test', {
      decision: 'accepted',
    });
    expect(result.json().data.proposeStatus).toBeNull();
    const status = (await send('GET', '/api/v1/candidate/status', 'flagged.test')).json().data;
    expect(status.current?.status ?? status.status).toBe('working');
    expect(application).toBeTruthy();
  });

  it('keeps the status untouched on acceptance', async () => {
    const { send, offer } = await setup();
    const own = offer('flagged.test');
    await send('PUT', `${BASE}/offers/${own.id}/decision`, 'flagged.test', {
      decision: 'accepted',
    });
    const status = (await send('GET', '/api/v1/candidate/status', 'flagged.test')).json().data;
    expect(status.current?.status ?? 'job_search').not.toBe('working');
  });

  it('answers 404 offer_not_found for another candidate or an application without an offer', async () => {
    const { send, offer, application } = await setup();
    const foreign = offer('other.test');
    const bare = application('flagged.test', 'applied');
    for (const id of [foreign.id, bare.id, 'nope']) {
      for (const [suffix, body] of [
        ['tax', { taxPercent: 10 }],
        ['decision', { decision: 'accepted' }],
      ] as const) {
        const response = await send('PUT', `${BASE}/offers/${id}/${suffix}`, 'flagged.test', body);
        expect(response.statusCode).toBe(404);
        expect(response.json().error.code).toBe('offer_not_found');
      }
    }
  });
});
