import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { candidateAuthorization, createApp, stores } from './appTestHarness';
import type { FactRewriteRequest } from './domain/experienceFactRewrite';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './domain/resumeDraft';
import type { ExperienceFactRewriter } from './providers/experienceFactRewriter';

const ORIGIN = 'http://localhost:3000';
const CLOUD = 'exp-cloud';

function rewriterAnswering(): ExperienceFactRewriter & { calls: FactRewriteRequest[] } {
  const calls: FactRewriteRequest[] = [];
  return {
    calls,
    rewrite: vi.fn(async (request: FactRewriteRequest) => {
      calls.push(request);
      const [team, load, fragment] = request.facts;
      return {
        places: [
          {
            experienceId: CLOUD,
            bullets: [
              {
                text: 'Расширил команду поддержки с 4 до 11 инженеров, следя за нагрузкой каждого.',
                sourceFactIds: [team!.id, load!.id],
              },
            ],
          },
        ],
        droppedFactIds: [fragment!.id],
        unmatchedFactIds: [],
      };
    }),
  };
}

async function candidateWithFacts(rewriter?: ExperienceFactRewriter) {
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
        title: 'Head of Technical Support',
        employer: 'Enterprise Public Cloud Platform',
        startDate: '2020-03',
        endDate: '2023-04',
        current: false,
        bulletMemoryIds: [],
      },
    ],
  };
  store.saveResumeDraft(candidateId, draft, []);
  const facts = [
    'Команда расширилась с четырех до одиннадцати',
    'следил за персональной нагрузкой каждого сотрудника',
    'Стало семь',
  ].map((statement) => store.addManualExperienceFact(candidateId, randomUUID(), statement));
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
});
