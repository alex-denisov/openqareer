import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/ownerConversationFacts.json';
import {
  applyFactRewrite,
  buildFactRewriteRequest,
  checkFactRewrite,
  EXPERIENCE_FACT_REWRITE_INSTRUCTIONS,
  factRewriteEdits,
  revertFactRewrite,
  rewriteSourceFacts,
  withStoredFactRewrites,
  type RewriteMemory,
} from './experienceFactRewrite';
import { resumeDraftSchema, type ResumeDraft } from './resumeDraft';

const memory = fixture.memory as unknown as RewriteMemory[];
const draft: ResumeDraft = {
  candidate: {},
  experience: fixture.experience.map((entry) => ({
    ...entry,
    chronologyMemoryId: `chronology-${entry.id}`,
    endDate: entry.endDate ?? undefined,
  })),
  education: [],
  languages: [],
} as ResumeDraft;

const ENERGY = 'imp6324433e42-exp-2';
const CLOUD = 'imp6324433e42-exp-3';
const statementOf = (id: string) => memory.find((item) => item.id === id)?.statement ?? '';
const idStarting = (prefix: string) => memory.find((item) => item.id.startsWith(prefix))!.id;

describe('rewriteSourceFacts on the owner’s 29.10 profile', () => {
  it('offers every confirmed conversation fact not yet in a workplace', () => {
    const facts = rewriteSourceFacts(draft, memory);
    expect(facts).toHaveLength(65);
    expect(facts.every((fact) => fact.provenance?.kind === 'candidate')).toBe(true);
  });

  it('skips facts declined or already rewritten into a bullet that is still there', () => {
    const declined = idStarting('7961bcb2');
    const rewritten = idStarting('cf8f74a6');
    const withRewrite: ResumeDraft = {
      ...draft,
      declinedFactIds: [declined],
      experience: draft.experience.map((entry) =>
        entry.id === CLOUD
          ? { ...entry, bulletMemoryIds: [...entry.bulletMemoryIds, 'b-1'] }
          : entry,
      ),
      factRewrites: [
        {
          id: 'r-1',
          appliedAt: '2026-10-29T10:00:00.000Z',
          bullets: [{ memoryId: 'b-1', experienceId: CLOUD, sourceFactIds: [rewritten] }],
          declinedFactIds: [],
        },
      ],
    };
    const ids = rewriteSourceFacts(withRewrite, memory).map((fact) => fact.id);
    expect(ids).toHaveLength(63);
    expect(ids).not.toContain(declined);
    expect(ids).not.toContain(rewritten);
  });

  it('offers a rewritten fact again once its bullet left the resume', () => {
    const rewritten = idStarting('cf8f74a6');
    const orphaned: ResumeDraft = {
      ...draft,
      factRewrites: [
        {
          id: 'r-1',
          appliedAt: '2026-10-29T10:00:00.000Z',
          bullets: [{ memoryId: 'gone', experienceId: CLOUD, sourceFactIds: [rewritten] }],
          declinedFactIds: [],
        },
      ],
    };
    expect(rewriteSourceFacts(orphaned, memory).map((fact) => fact.id)).toContain(rewritten);
  });
});

describe('buildFactRewriteRequest', () => {
  it('sends every place with its imported bullets and only the source facts', () => {
    const request = buildFactRewriteRequest(draft, memory);
    expect(request.places).toHaveLength(6);
    const energy = request.places.find((place) => place.experienceId === ENERGY)!;
    expect(energy.employer).toBe('Enterprise Energy IT Services');
    expect(energy.period).toBe('Apr 2023 — Oct 2025');
    expect(energy.existingBullets.length).toBeGreaterThan(0);
    expect(request.facts).toHaveLength(65);
    expect(request.facts.map((fact) => fact.statement)).toContain('Стало семь');
  });

  it('tells the model to drop fragments and never invent numbers', () => {
    expect(EXPERIENCE_FACT_REWRITE_INSTRUCTIONS).toContain('Стало семь');
    expect(EXPERIENCE_FACT_REWRITE_INSTRUCTIONS).toContain('Ничего не придумывай');
    expect(EXPERIENCE_FACT_REWRITE_INSTRUCTIONS).toContain('Россети Цифра');
  });
});

describe('checkFactRewrite', () => {
  const request = buildFactRewriteRequest(draft, memory);
  const team = idStarting('cf8f74a6');
  const load = idStarting('da875536');
  const tickets = idStarting('7d2e7b0b');
  const fragment = idStarting('7961bcb2');

  it('keeps sourced bullets, merges a place named twice and leaves the rest out', () => {
    const proposal = checkFactRewrite(
      request,
      {
        places: [
          {
            experienceId: CLOUD,
            bullets: [
              {
                text: 'Расширил команду поддержки с 4 до 11 инженеров, контролируя нагрузку каждого',
                sourceFactIds: [team, load],
              },
            ],
          },
          {
            experienceId: CLOUD,
            bullets: [{ text: '— Сократил число тикетов на 40%.', sourceFactIds: [tickets] }],
          },
        ],
        droppedFactIds: [fragment],
        unmatchedFactIds: [],
      },
      'r-1',
    );
    expect(proposal.places).toEqual([
      {
        experienceId: CLOUD,
        bullets: [
          {
            text: 'Расширил команду поддержки с 4 до 11 инженеров, контролируя нагрузку каждого.',
            sourceFactIds: [team, load],
          },
          { text: 'Сократил число тикетов на 40%.', sourceFactIds: [tickets] },
        ],
      },
    ]);
    expect(proposal.leftOutFactIds).toHaveLength(62);
    expect(proposal.leftOutFactIds).toContain(fragment);
  });

  it('drops a bullet with an invented number, an unknown place or a foreign fact', () => {
    const proposal = checkFactRewrite(
      request,
      {
        places: [
          {
            experienceId: CLOUD,
            bullets: [
              { text: 'Сократил число тикетов на 55% за год.', sourceFactIds: [tickets] },
              { text: 'Сократил число тикетов вдвое за счёт ботов.', sourceFactIds: ['nope'] },
            ],
          },
          {
            experienceId: 'made-up',
            bullets: [{ text: 'Сократил число тикетов на 40%.', sourceFactIds: [tickets] }],
          },
        ],
      },
      'r-1',
    );
    expect(proposal.places).toEqual([]);
    expect(proposal.leftOutFactIds).toHaveLength(65);
  });

  it('refuses a bullet in the first person', () => {
    const proposal = checkFactRewrite(
      request,
      {
        places: [
          {
            experienceId: CLOUD,
            bullets: [
              { text: 'Включил затраты подрядчиков в мой P&L.', sourceFactIds: [tickets] },
              { text: 'Мы сократили число тикетов на 40%.', sourceFactIds: [tickets] },
            ],
          },
        ],
      },
      'r-1',
    );
    expect(proposal.places).toEqual([]);
  });

  it('refuses a bullet that copies the candidate’s words verbatim', () => {
    const proposal = checkFactRewrite(
      request,
      {
        places: [
          {
            experienceId: CLOUD,
            bullets: [{ text: statementOf(team), sourceFactIds: [team] }],
          },
        ],
      },
      'r-1',
    );
    expect(proposal.places).toEqual([]);
  });
});

describe('applyFactRewrite and revertFactRewrite', () => {
  const request = buildFactRewriteRequest(draft, memory);
  const tickets = idStarting('7d2e7b0b');
  const revenue = idStarting('d73936df');
  const proposal = checkFactRewrite(
    request,
    {
      places: [
        {
          experienceId: CLOUD,
          bullets: [{ text: 'Сократил число тикетов на 40%.', sourceFactIds: [tickets] }],
        },
        {
          experienceId: ENERGY,
          bullets: [{ text: 'Увеличил выручку направления в 4 раза.', sourceFactIds: [revenue] }],
        },
      ],
    },
    'r-1',
  );
  let next = 0;
  const applied = applyFactRewrite(
    draft,
    proposal,
    () => `bullet-${++next}`,
    '2026-10-29T12:00:00.000Z',
  );

  it('appends new bullet facts to their places and declines what was left out', () => {
    const cloud = applied.draft.experience.find((entry) => entry.id === CLOUD)!;
    const energy = applied.draft.experience.find((entry) => entry.id === ENERGY)!;
    expect(energy.bulletMemoryIds.at(-1)).toBe('bullet-1');
    expect(cloud.bulletMemoryIds.at(-1)).toBe('bullet-2');
    expect(applied.statements.map((bullet) => bullet.text)).toEqual([
      'Увеличил выручку направления в 4 раза.',
      'Сократил число тикетов на 40%.',
    ]);
    expect(applied.draft.declinedFactIds).toHaveLength(63);
    expect(rewriteSourceFacts(applied.draft, memory)).toEqual([]);
    expect(factRewriteEdits(applied.draft).map((edit) => edit.appliedChronologyMemoryId)).toEqual([
      'bullet-1',
      'bullet-2',
    ]);
    expect(resumeDraftSchema.safeParse(applied.draft).success).toBe(true);
  });

  it('undoes exactly that rewrite', () => {
    const reverted = revertFactRewrite(applied.draft, 'r-1')!;
    expect([...reverted.bulletMemoryIds].sort()).toEqual(['bullet-1', 'bullet-2']);
    expect(reverted.draft.experience).toEqual(draft.experience);
    expect(reverted.draft.declinedFactIds).toEqual([]);
    expect(reverted.draft.factRewrites).toEqual([]);
    expect(rewriteSourceFacts(reverted.draft, memory)).toHaveLength(65);
    expect(revertFactRewrite(reverted.draft, 'r-1')).toBeNull();
  });
});

describe('review fixes (29.10)', () => {
  const request = buildFactRewriteRequest(draft, memory);
  const tickets = idStarting('7d2e7b0b');
  const proposal = checkFactRewrite(
    request,
    {
      places: [
        {
          experienceId: CLOUD,
          bullets: [{ text: 'Сократил число тикетов на 40%.', sourceFactIds: [tickets] }],
        },
      ],
    },
    'r-1',
  );

  it('never offers a consultant bullet that lost its place as a source', () => {
    const applied = applyFactRewrite(draft, proposal, () => 'bullet-1', '2026-10-29T12:00:00.000Z');
    const unplaced: ResumeDraft = { ...applied.draft, experience: draft.experience };
    const consultantBullet = { ...memory[0]!, id: 'bullet-1', provenance: { kind: 'consultant' } };
    const ids = rewriteSourceFacts(unplaced, [...memory, consultantBullet]).map((fact) => fact.id);
    expect(ids).not.toContain('bullet-1');
  });

  it('creates no fact for a bullet a full place could not take', () => {
    const full: ResumeDraft = {
      ...draft,
      experience: draft.experience.map((entry) =>
        entry.id === CLOUD
          ? { ...entry, bulletMemoryIds: Array.from({ length: 80 }, (_, i) => `old-${i}`) }
          : entry,
      ),
    };
    const applied = applyFactRewrite(full, proposal, () => 'bullet-1', '2026-10-29T12:00:00.000Z');
    expect(applied.statements).toEqual([]);
    expect(applied.record.bullets).toEqual([]);
  });

  it('keeps only the latest 50 rewrite records, so the 51st accept still saves', () => {
    let current = draft;
    for (let index = 0; index < 51; index += 1) {
      current = applyFactRewrite(
        current,
        { ...proposal, id: `r-${index}` },
        () => `bullet-${index}`,
        '2026-10-29T12:00:00.000Z',
      ).draft;
    }
    expect(current.factRewrites).toHaveLength(50);
    expect(current.factRewrites?.[0]?.id).toBe('r-1');
    expect(resumeDraftSchema.safeParse(current).success).toBe(true);
  });

  it('keeps the stored rewrite records whatever a client save sends', () => {
    const stored = applyFactRewrite(draft, proposal, () => 'bullet-1', '2026-10-29T12:00:00.000Z');
    expect(withStoredFactRewrites(draft, stored.draft).factRewrites).toEqual(
      stored.draft.factRewrites,
    );
    const forged = { ...draft, factRewrites: stored.draft.factRewrites };
    expect(withStoredFactRewrites(forged, draft).factRewrites).toBeUndefined();
  });
});
