import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { candidateAuthorization, createApp, stores } from './appTestHarness';
import type { BulletTranslationRequest } from './domain/experienceBulletLanguage';
import type { FactRewriteRequest } from './domain/experienceFactRewrite';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './domain/resumeDraft';
import type { ExperienceFactRewriter } from './providers/experienceFactRewriter';

const ORIGIN = 'http://localhost:3000';
const CLOUD = 'exp-cloud';

/** Заглушки модели находят факты по тексту: порядок фактов в запросе тест не задаёт. */
function factsOf(request: FactRewriteRequest) {
  const starting = (start: string) =>
    request.facts.find((fact) => fact.statement.startsWith(start))!;
  return { team: starting('Команда'), load: starting('следил'), fragment: starting('Стало') };
}

function rewriterAnswering(): ExperienceFactRewriter & { calls: FactRewriteRequest[] } {
  const calls: FactRewriteRequest[] = [];
  return {
    calls,
    rewrite: vi.fn(async (request: FactRewriteRequest) => {
      calls.push(request);
      const { team, load, fragment } = factsOf(request);
      return {
        places: [
          {
            experienceId: CLOUD,
            bullets: [
              {
                text: 'Расширил команду поддержки с 4 до 11 инженеров, следя за нагрузкой каждого.',
                sourceFactIds: [team.id, load.id],
              },
            ],
          },
        ],
        droppedFactIds: [fragment.id],
        unmatchedFactIds: [],
      };
    }),
  };
}

async function candidateWithFacts(
  rewriter?: ExperienceFactRewriter,
  title = 'Руководитель технической поддержки',
) {
  const app = await createApp(undefined, undefined, undefined, {
    ...(rewriter ? { experienceFactRewriter: rewriter } : {}),
  });
  const authorization = candidateAuthorization(app);
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/candidate/me',
    headers: { authorization },
  });
  const candidateId = me.json().data.candidate.id as string;
  const store = stores[stores.length - 1]!;
  const draft: ResumeDraft = {
    ...EMPTY_RESUME_DRAFT,
    experience: [
      {
        id: CLOUD,
        chronologyMemoryId: 'chronology-cloud',
        title,
        employer: 'Enterprise Public Cloud Platform',
        startDate: '2020-03',
        endDate: '2023-04',
        current: false,
        bulletMemoryIds: [],
      },
    ],
  };
  store.saveResumeDraft(candidateId, draft, []);
  // Память идёт по `created_at, id`. Факты одной миллисекунды упорядочивает id, поэтому здесь
  // время одно, а id идут обратно порядку добавления: так порядок фактов в запросе не совпадает
  // с порядком в тесте при каждом прогоне, а не изредка, как было со случайными id.
  vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
  const facts = [
    'Команда расширилась с четырех до одиннадцати',
    'следил за персональной нагрузкой каждого сотрудника',
    'Стало семь',
  ].map((statement, index) =>
    store.addManualExperienceFact(candidateId, `${9 - index}${randomUUID().slice(1)}`, statement),
  );
  vi.useRealTimers();
  const headers = { authorization, origin: ORIGIN };
  return { app, headers, candidateId, store, facts };
}

describe('consultant rewrite of conversation facts (29.10)', () => {
  it('proposes once, applies new consultant bullets and undoes them', async () => {
    const rewriter = rewriterAnswering();
    const { app, headers, candidateId, store, facts } = await candidateWithFacts(rewriter);
    const url = '/api/v1/candidate/experience-fact-rewrite';

    const first = await app.inject({ method: 'POST', url, headers });
    const again = await app.inject({ method: 'POST', url, headers });
    expect(first.statusCode).toBe(200);
    const proposal = first.json().data.proposal;
    expect(again.json().data.proposal.id).toBe(proposal.id);
    expect(rewriter.calls).toHaveLength(1);
    expect(rewriter.calls[0]!.facts.map((fact) => fact.statement)).toContain('Стало семь');
    expect(proposal.leftOutFactIds).toEqual([facts[2]!.id]);

    const applied = await app.inject({
      method: 'POST',
      url: `${url}/${proposal.id}/apply`,
      headers,
    });
    expect(applied.statusCode).toBe(200);
    const snapshot = store.getSnapshot(candidateId);
    const place = snapshot.resume!.draft.experience[0]!;
    expect(place.bulletMemoryIds).toHaveLength(1);
    const bullet = snapshot.memory.find((item) => item.id === place.bulletMemoryIds[0])!;
    expect(bullet.statement).toBe(
      'Расширил команду поддержки с 4 до 11 инженеров, следя за нагрузкой каждого.',
    );
    expect(bullet.provenance?.kind).toBe('consultant');
    expect(bullet.sourceMessageIds).toEqual([
      ...facts[0]!.sourceMessageIds,
      ...facts[1]!.sourceMessageIds,
    ]);
    // The candidate's own words stay in memory untouched, and no fragment reached the place.
    for (const fact of facts) {
      expect(snapshot.memory.find((item) => item.id === fact.id)?.statement).toBe(fact.statement);
      expect(place.bulletMemoryIds).not.toContain(fact.id);
    }
    expect(snapshot.resume!.draft.declinedFactIds).toEqual([facts[2]!.id]);
    const nothingLeft = await app.inject({ method: 'POST', url, headers });
    expect(nothingLeft.json().data.proposal).toBeNull();

    const rewriteId = applied.json().data.rewrite.id as string;
    const reverted = await app.inject({
      method: 'POST',
      url: `${url}/${rewriteId}/revert`,
      headers,
    });
    expect(reverted.statusCode).toBe(200);
    const restored = store.getSnapshot(candidateId);
    expect(restored.resume!.draft.experience[0]!.bulletMemoryIds).toEqual([]);
    expect(restored.resume!.draft.declinedFactIds).toEqual([]);
    expect(restored.memory.some((item) => item.id === bullet.id)).toBe(false);
    const twice = await app.inject({ method: 'POST', url: `${url}/${rewriteId}/revert`, headers });
    expect(twice.statusCode).toBe(404);
  });

  it('refuses to apply a proposal whose facts changed meanwhile', async () => {
    const { app, headers, candidateId, store } = await candidateWithFacts(rewriterAnswering());
    const url = '/api/v1/candidate/experience-fact-rewrite';
    const proposal = (await app.inject({ method: 'POST', url, headers })).json().data.proposal;
    store.addManualExperienceFact(candidateId, randomUUID(), 'Внедрил круглосуточный режим.');
    const applied = await app.inject({
      method: 'POST',
      url: `${url}/${proposal.id}/apply`,
      headers,
    });
    expect(applied.statusCode).toBe(409);
    expect(store.getSnapshot(candidateId).resume!.draft.experience[0]!.bulletMemoryIds).toEqual([]);
  });

  it('answers 503 without a model route and 502 when the model fails', async () => {
    const without = await candidateWithFacts();
    const url = '/api/v1/candidate/experience-fact-rewrite';
    expect(
      (await without.app.inject({ method: 'POST', url, headers: without.headers })).statusCode,
    ).toBe(503);
    const failing = await candidateWithFacts({ rewrite: async () => null });
    expect(
      (await failing.app.inject({ method: 'POST', url, headers: failing.headers })).statusCode,
    ).toBe(502);
  });

  it('keeps the proposal on the server draft, so a client save or restart shows the same words', async () => {
    const rewriter = rewriterAnswering();
    const { app, headers, candidateId, store } = await candidateWithFacts(rewriter);
    const url = '/api/v1/candidate/experience-fact-rewrite';
    const proposal = (await app.inject({ method: 'POST', url, headers })).json().data.proposal;
    const stored = store.getSnapshot(candidateId).resume!.draft.factRewriteProposal;
    expect(stored?.proposal.id).toBe(proposal.id);
    const { factRewriteProposal: _dropped, ...clientDraft } =
      store.getSnapshot(candidateId).resume!.draft;
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers,
      payload: clientDraft,
    });
    expect(saved.statusCode).toBe(200);
    expect(store.getSnapshot(candidateId).resume!.draft.factRewriteProposal?.proposal.id).toBe(
      proposal.id,
    );
    const again = await app.inject({ method: 'POST', url, headers });
    expect(again.json().data.proposal).toEqual(proposal);
    expect(rewriter.calls).toHaveLength(1);
  });

  it('asks the model again when a bullet’s arithmetic does not add up', async () => {
    const calls: FactRewriteRequest[] = [];
    const rewriter: ExperienceFactRewriter = {
      rewrite: async (request) => {
        calls.push(request);
        const { team, load } = factsOf(request);
        const text =
          calls.length === 1
            ? 'Расширил команду поддержки с 4 до 11 инженеров, добавив 3 сотрудников.'
            : 'Расширил команду поддержки с 4 до 11 инженеров, следя за нагрузкой каждого.';
        return {
          places: [{ experienceId: CLOUD, bullets: [{ text, sourceFactIds: [team.id, load.id] }] }],
        };
      },
    };
    const { app, headers } = await candidateWithFacts(rewriter);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/experience-fact-rewrite',
      headers,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.corrections?.[0]).toContain('добавив 3');
    expect(response.json().data.proposal.places[0].bullets[0].text).toContain('следя за нагрузкой');
  });

  it('applies the edited set the candidate accepted', async () => {
    const { app, headers, candidateId, store, facts } =
      await candidateWithFacts(rewriterAnswering());
    const url = '/api/v1/candidate/experience-fact-rewrite';
    const proposal = (await app.inject({ method: 'POST', url, headers })).json().data.proposal;
    const applied = await app.inject({
      method: 'POST',
      url: `${url}/${proposal.id}/apply`,
      headers,
      payload: {
        edits: { [`${CLOUD}#0`]: 'Вырастил вторую линию поддержки с 4 до 11 инженеров.' },
      },
    });
    expect(applied.statusCode).toBe(200);
    const snapshot = store.getSnapshot(candidateId);
    const place = snapshot.resume!.draft.experience[0]!;
    expect(snapshot.memory.find((item) => item.id === place.bulletMemoryIds[0])?.statement).toBe(
      'Вырастил вторую линию поддержки с 4 до 11 инженеров.',
    );
    expect(snapshot.resume!.draft.factRewriteProposal).toBeUndefined();
    const removedAll = await candidateWithFacts(rewriterAnswering());
    const second = (
      await removedAll.app.inject({ method: 'POST', url, headers: removedAll.headers })
    ).json().data.proposal;
    const refused = await removedAll.app.inject({
      method: 'POST',
      url: `${url}/${second.id}/apply`,
      headers: removedAll.headers,
      payload: { edits: { [`${CLOUD}#0`]: null } },
    });
    expect(refused.statusCode).toBe(400);
    expect(facts).toHaveLength(3);
  });

  it('translates a waiting Russian proposal into the English profile’s language, keeping its facts', async () => {
    const english = 'Grew the support team from 4 to 11 engineers, tracking the workload of each.';
    const rewrites: FactRewriteRequest[] = [];
    const translations: BulletTranslationRequest[] = [];
    const rewriter: ExperienceFactRewriter = {
      rewrite: async (request) => {
        rewrites.push(request);
        const { team, load } = factsOf(request);
        return {
          places: [
            {
              experienceId: CLOUD,
              bullets: [{ text: english, sourceFactIds: [team.id, load.id] }],
            },
          ],
        };
      },
      translate: async (request) => {
        translations.push(request);
        return { bullets: request.bullets.map((bullet) => ({ key: bullet.key, text: english })) };
      },
    };
    const { app, headers, candidateId, store } = await candidateWithFacts(
      rewriter,
      'Head of Technical Support',
    );
    const url = '/api/v1/candidate/experience-fact-rewrite';
    await app.inject({ method: 'POST', url, headers });
    // What the code before 01.11 left waiting: the same proposal, in Russian.
    const { digest, proposal: fresh } =
      store.getSnapshot(candidateId).resume!.draft.factRewriteProposal!;
    const russian = {
      ...fresh,
      places: fresh.places.map((place) => ({
        ...place,
        bullets: place.bullets.map((bullet) => ({
          ...bullet,
          text: 'Расширил команду поддержки с 4 до 11 инженеров, следя за нагрузкой каждого.',
        })),
      })),
    };
    store.saveFactRewriteProposal(candidateId, { digest, proposal: russian }, () => true);
    const response = await app.inject({ method: 'POST', url, headers });
    const proposal = response.json().data.proposal;
    expect(rewrites).toHaveLength(1);
    expect(translations[0]!.bullets.map((bullet) => bullet.language)).toEqual(['en']);
    expect(proposal.id).not.toBe(russian.id);
    expect(proposal.places[0].bullets).toEqual([
      {
        text: english,
        sourceFactIds: russian.places[0]!.bullets[0]!.sourceFactIds,
      },
    ]);
    const stored = store.getSnapshot(candidateId).resume!.draft.factRewriteProposal!;
    expect(stored.digest).toBe(digest);
    expect(stored.proposal).toEqual(proposal);
    const again = await app.inject({ method: 'POST', url, headers });
    expect(again.json().data.proposal).toEqual(proposal);
    expect(translations).toHaveLength(1);
  });
});

describe('accepting consultant bullets confirms the workplace (01.11)', () => {
  const trusted = { status: 'confirmed', confidence: 'candidate-confirmed' };

  async function acceptedRewrite() {
    const ctx = await candidateWithFacts(rewriterAnswering());
    ctx.store.importResumeEvidence(ctx.candidateId, {
      sourceLabel: 'LinkedIn',
      entries: [
        { memoryId: 'chronology-cloud', domain: 'role-evidence', statement: 'Cloud · 2020–2023' },
      ],
    });
    const url = '/api/v1/candidate/experience-fact-rewrite';
    const proposal = (await ctx.app.inject({ method: 'POST', url, headers: ctx.headers })).json()
      .data.proposal;
    const applied = await ctx.app.inject({
      method: 'POST',
      url: `${url}/${proposal.id}/apply`,
      headers: ctx.headers,
    });
    expect(applied.statusCode).toBe(200);
    return { ...ctx, url, rewriteId: applied.json().data.rewrite.id as string };
  }

  const chronology = (ctx: Awaited<ReturnType<typeof acceptedRewrite>>) =>
    ctx.store.getSnapshot(ctx.candidateId).memory.find((item) => item.id === 'chronology-cloud');

  it('marks every fact of the place candidate-confirmed with the consultant date', async () => {
    const ctx = await acceptedRewrite();
    expect(chronology(ctx)).toMatchObject({
      ...trusted,
      consultantConfirmedAt: expect.any(String),
    });
  });

  it('undoing the rewrite restores the previous trust of the place', async () => {
    const ctx = await acceptedRewrite();
    const reverted = await ctx.app.inject({
      method: 'POST',
      url: `${ctx.url}/${ctx.rewriteId}/revert`,
      headers: ctx.headers,
    });
    expect(reverted.statusCode).toBe(200);
    expect(chronology(ctx)).not.toMatchObject(trusted);
    expect(chronology(ctx)?.consultantConfirmedAt).toBeUndefined();
  });

  it('reads a place accepted before the change log as confirmed, without writing', async () => {
    const ctx = await acceptedRewrite();
    const { database } = ctx.store as unknown as {
      database: { prepare(sql: string): { run(...args: unknown[]): unknown } };
    };
    database.prepare('DELETE FROM profile_change_log WHERE candidate_id = ?').run(ctx.candidateId);
    database
      .prepare(
        `UPDATE memory SET status = 'proposed', confidence = 'candidate-reported'
         WHERE candidate_id = ? AND id = 'chronology-cloud'`,
      )
      .run(ctx.candidateId);

    expect(chronology(ctx)).toMatchObject({
      ...trusted,
      consultantConfirmedAt: expect.any(String),
    });
    const reverted = await ctx.app.inject({
      method: 'POST',
      url: `${ctx.url}/${ctx.rewriteId}/revert`,
      headers: ctx.headers,
    });
    expect(reverted.statusCode).toBe(200);
    expect(chronology(ctx)).toMatchObject({ status: 'proposed', confidence: 'candidate-reported' });
  });

  async function historyOf(ctx: Awaited<ReturnType<typeof acceptedRewrite>>) {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/candidate/profile/history',
      headers: { authorization: ctx.headers.authorization },
    });
    return response.json().data as {
      total: number;
      entries: {
        id: string;
        actor: string;
        section: string;
        previousText: string;
        appliedText: string;
        details?: string[];
        revertedAt: string | null;
      }[];
    };
  }

  it('a rewrite accepted before the change log is in the history and «Вернуть» undoes it', async () => {
    const ctx = await acceptedRewrite();
    const { database } = ctx.store as unknown as {
      database: { prepare(sql: string): { run(...args: unknown[]): unknown } };
    };
    database.prepare('DELETE FROM profile_change_log WHERE candidate_id = ?').run(ctx.candidateId);

    const page = await historyOf(ctx);
    expect(page.total).toBe(1);
    const [entry] = page.entries;
    expect(entry).toMatchObject({ actor: 'consultant', section: 'experience', revertedAt: null });
    expect(entry!.appliedText).toMatch(/^Место работы подтверждено: /);
    expect(entry!.previousText).toBe('');
    expect(entry!.details!.join(' ')).toContain('Расширил команду поддержки');

    const reverted = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/candidate/profile/history/${entry!.id}/revert`,
      headers: ctx.headers,
    });
    expect(reverted.statusCode).toBe(200);
    const place = ctx.store.getSnapshot(ctx.candidateId).resume!.draft.experience[0]!;
    expect(place.bulletMemoryIds).toEqual([]);
  });

  it('a logged rewrite shows the accepted bullets, once', async () => {
    const ctx = await acceptedRewrite();
    const page = await historyOf(ctx);
    expect(page.total).toBe(1);
    const [logged] = page.entries;
    expect(logged!.appliedText).toMatch(/^Место работы подтверждено: [^«]+$/);
    expect(logged!.previousText).toBe('');
    expect(logged!.details!.join(' ')).toContain('Расширил команду поддержки');
  });
});
