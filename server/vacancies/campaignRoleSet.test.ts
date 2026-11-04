import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StoredMemory } from '../data/candidateStore';
import { buildCampaignRoleSet, type CampaignRoleModel } from './campaignRoleSet';
import { campaignRoleFacts } from './rebuildCampaignRoles';

/** adenisov.test memory on prod 03.11 (owner's own data, sensitive rows left out). */
const ownerMemory = JSON.parse(
  readFileSync(new URL('./__fixtures__/adenisovTestMemory.json', import.meta.url), 'utf8'),
) as StoredMemory[];

const facts = [
  { ref: 'memory:title', statement: 'VP of Technology & Operations' },
  { ref: 'memory:vp', statement: 'VP Engineering: led platform and engineering' },
  { ref: 'memory:coo', statement: 'COO: owned operations and delivery' },
] as const;

describe('buildCampaignRoleSet (B267 S5)', () => {
  it('на фиктивной модели принимает 5–10 ролей только из кандидатного набора', async () => {
    const model: CampaignRoleModel = {
      propose: async ({ candidates }) =>
        candidates.slice(0, 6).map((role, index) => ({
          id: role.id,
          level: role.levels.at(-1)!,
          kind: index === 0 ? 'primary' : 'adjacent',
          evidenceRefs: [facts[index % facts.length].ref],
          reason: 'Подтверждено фактом профиля',
        })),
    };
    const result = await buildCampaignRoleSet({ facts, profileTitle: facts[0].statement, model });

    expect(result.roles.length).toBeGreaterThanOrEqual(6);
    expect(result.roles.length).toBeLessThanOrEqual(10);
    expect(result.roles[0].kind).toBe('primary');
    expect(
      result.roles.every((role) => role.title && role.titleRu && role.evidenceRefs.length > 0),
    ).toBe(true);
  });

  it('отклоняет ответ модели короче пяти ролей и использует правила', async () => {
    const result = await buildCampaignRoleSet({
      facts,
      profileTitle: facts[0].statement,
      model: {
        propose: async ({ candidates }) =>
          candidates.slice(0, 4).map((role, index) => ({
            id: role.id,
            level: role.levels.at(-1)!,
            kind: index === 0 ? 'primary' : 'adjacent',
            evidenceRefs: [facts[index % facts.length].ref],
            reason: 'Подтверждено фактом профиля',
          })),
      },
    });

    expect(result.model).toBe('rules');
    expect(result.roles.length).toBeGreaterThanOrEqual(5);
    expect(result.roles.length).toBeLessThanOrEqual(10);
  });

  it('отклоняет ответ с повтором одной роли, который сокращает набор ниже пяти', async () => {
    const result = await buildCampaignRoleSet({
      facts,
      profileTitle: facts[0].statement,
      model: {
        propose: async ({ candidates }) => {
          const proposed = candidates.slice(0, 4).map((role, index) => ({
            id: role.id,
            level: role.levels.at(-1)!,
            kind: index === 0 ? 'primary' : 'adjacent',
            evidenceRefs: [facts[index % facts.length].ref],
            reason: 'Подтверждено фактом профиля',
          }));
          return [...proposed, proposed[1]];
        },
      },
    });

    expect(result.model).toBe('rules');
    expect(result.roles.length).toBeGreaterThanOrEqual(5);
    expect(new Set(result.roles.map((role) => role.id)).size).toBe(result.roles.length);
  });

  it('отбрасывает весь ответ модели с чужим id или без evidenceRefs', async () => {
    for (const bad of [
      [
        {
          id: 'outside.role',
          level: 'vp',
          kind: 'primary',
          evidenceRefs: ['memory:title'],
          reason: 'x',
        },
      ],
      [{ id: 'eng-mgmt.cto', level: 'c-level', kind: 'primary', evidenceRefs: [], reason: 'x' }],
    ]) {
      const result = await buildCampaignRoleSet({
        facts,
        profileTitle: facts[0].statement,
        model: { propose: async () => bad } as CampaignRoleModel,
      });
      expect(result.model).toBe('rules');
      expect(result.roles.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('без модели даёт 5–10 релевантных ролей и не возвращает dismissed', async () => {
    const result = await buildCampaignRoleSet({
      facts,
      profileTitle: facts[0].statement,
      dismissed: ['eng-mgmt.cto'],
    });
    const titles = result.roles.map((role) => role.title);

    expect(result.model).toBe('rules');
    expect(result.roles.length).toBeGreaterThanOrEqual(5);
    expect(result.roles.length).toBeLessThanOrEqual(10);
    expect(result.roles.some((role) => role.id === 'eng-mgmt.cto')).toBe(false);
    expect(titles.some((title) => /Engineering|Technology/u.test(title))).toBe(true);
    expect(titles.some((title) => /Operations|Operating/u.test(title))).toBe(true);
  });

  it('всегда ограничивает набор десятью ролями', async () => {
    const result = await buildCampaignRoleSet({ facts, profileTitle: facts[0].statement });
    expect(result.roles.length).toBeLessThanOrEqual(10);
  });

  it('на профиле adenisov.test правила ставят CTO и CIO в первую пятёрку без Audit, Communications и Design', async () => {
    const result = await buildCampaignRoleSet({
      facts: campaignRoleFacts(ownerMemory),
      profileTitle: null,
    });
    const ids = result.roles.map((role) => role.id);

    expect(result.model).toBe('rules');
    expect(ids.slice(0, 5)).toEqual(expect.arrayContaining(['eng-mgmt.cto', 'it-ops.cio']));
    expect(result.roles.map((role) => role.functions[0])).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(audit-risk|pr|design)$/u)]),
    );
    expect(result.roles.every((role) => role.evidenceRefs.length > 0)).toBe(true);
  });

  it('гипотезы и вопросы консультанта не попадают во вход ролей', () => {
    const facts = campaignRoleFacts(ownerMemory);
    const byRef = new Map(ownerMemory.map((fact) => [`memory:${fact.id}`, fact]));

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => byRef.get(fact.ref)?.kind === 'fact')).toBe(true);
    expect(
      facts.filter((fact) => fact.position).map((fact) => fact.statement.split(' — ')[0]),
    ).toContain('VP of Technology & IT Operations');
  });

  it('ответ модели с одной неверной ссылкой теряет только эту роль, а причина пишется в журнал', async () => {
    const facts = campaignRoleFacts(ownerMemory);
    const logged: string[] = [];
    const result = await buildCampaignRoleSet({
      facts,
      profileTitle: null,
      log: (_fields, message) => logged.push(message),
      model: {
        name: 'gemini-test',
        propose: async ({ candidates }) =>
          candidates.slice(0, 10).map((role, index) => ({
            id: role.id,
            level: role.levels.at(-1)!,
            kind: index === 0 ? 'primary' : 'adjacent',
            evidenceRefs: [index === 3 ? 'memory:not-a-fact' : facts[index].ref],
            reason: 'Подтверждено фактом профиля',
          })),
      },
    });

    // Nine model roles stay; the three strongest by position then take the ceiling of ten.
    expect(result.model).toBe('gemini-test+rules');
    expect(result.roles).toHaveLength(10);
    expect(result.roles.filter((role) => role.kind === 'primary')).toHaveLength(1);
    expect(logged).toContain('campaign-role-model-items-dropped');
  });

  it('ошибку вызова модели пишет в журнал и собирает роли правилами', async () => {
    const logged: Array<[Record<string, unknown>, string]> = [];
    const result = await buildCampaignRoleSet({
      facts,
      profileTitle: facts[0].statement,
      log: (fields, message) => logged.push([fields, message]),
      model: {
        propose: async () => {
          throw new Error('quota exhausted');
        },
      },
    });

    expect(result.model).toBe('rules');
    expect(logged).toEqual([
      [{ errorName: 'Error', errorMessage: 'quota exhausted' }, 'campaign-role-model-failed'],
    ]);
  });

  it('должность и её соседи по онтологии — обязательные кандидаты: Head of IT ведёт к CIO у кандидата уровня C', async () => {
    const result = await buildCampaignRoleSet({
      facts: [
        {
          ref: 'memory:it',
          statement: 'Head of IT — Bank (2019 — 2024)',
          domain: 'role-evidence',
          position: true,
        },
        {
          ref: 'memory:cfo',
          statement: 'CFO — Retail Group (2015 — 2019)',
          domain: 'role-evidence',
          position: true,
        },
      ],
      profileTitle: null,
    });

    expect(result.roles.map((role) => role.id)).toEqual(
      expect.arrayContaining(['it-ops.head', 'it-ops.cio']),
    );
  });

  it('без фактов-доказательств роли не предлагаются, даже если есть заголовок', async () => {
    const result = await buildCampaignRoleSet({ facts: [], profileTitle: 'VP of Technology' });

    expect(result.roles).toEqual([]);
  });

  it('когда модель теряет роли только из-за отклонённых, список добирается правилами до пяти', async () => {
    const facts = campaignRoleFacts(ownerMemory);
    const logged: Array<[Record<string, unknown>, string]> = [];
    const answer = ['it-ops.cio', 'eng-mgmt.cto', 'ops.coo', 'product.cpo', 'support.cco', 'exec-general.ceo'];
    const result = await buildCampaignRoleSet({
      facts,
      profileTitle: null,
      dismissed: ['it-ops.cio', 'eng-mgmt.cto'],
      log: (fields, message) => logged.push([fields, message]),
      model: {
        name: 'gemini-test',
        propose: async () => answer.map((id, index) => ({
          id,
          level: 'c-level',
          kind: index === 0 ? 'primary' : 'adjacent',
          evidenceRefs: [facts[0].ref],
          reason: 'Подтверждено фактом профиля',
        })),
      },
    });
    const ids = result.roles.map((role) => role.id);

    expect(ids.slice(0, 4)).toEqual(['ops.coo', 'product.cpo', 'support.cco', 'exec-general.ceo']);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(ids).not.toContain('it-ops.cio');
    expect(ids).not.toContain('eng-mgmt.cto');
    expect(result.roles.filter((role) => role.kind === 'primary')).toHaveLength(1);
    expect(result.model).toBe('gemini-test+rules');
    expect(logged.map(([, message]) => message)).toContain('campaign-role-model-topped-up');
    expect(logged.map(([, message]) => message)).not.toContain('campaign-role-model-rejected');
  });

  it('ответ, который короток не из-за отклонённых, по-прежнему уходит правилам', async () => {
    const facts = campaignRoleFacts(ownerMemory);
    const result = await buildCampaignRoleSet({
      facts,
      profileTitle: null,
      dismissed: ['it-ops.cio'],
      model: {
        propose: async () => ['it-ops.cio', 'eng-mgmt.cto', 'ops.coo'].map((id, index) => ({
          id,
          level: 'c-level',
          kind: index === 0 ? 'primary' : 'adjacent',
          evidenceRefs: [facts[0].ref],
          reason: 'Подтверждено фактом профиля',
        })),
      },
    });

    expect(result.model).toBe('rules');
  });

  describe('сильнейшие роли по правилам всегда добавляются к ответу модели', () => {
    const answer = (ids: readonly string[], evidenceRef: string, primary = ids[0]) =>
      ids.map((id) => ({
        id,
        level: 'vp',
        kind: id === primary ? 'primary' : 'adjacent',
        evidenceRefs: [evidenceRef],
        reason: 'Подтверждено фактом профиля',
      }));
    const modelAnswer = [
      'it-ops.vp',
      'ops.coo',
      'it-ops.head',
      'support.head',
      'eng.architecture.solutions',
      'consulting.it-consultant.ic',
    ];

    it('ответ без CTO и CIO на фикстуре adenisov.test получает обе роли, основная остаётся за моделью', async () => {
      const facts = campaignRoleFacts(ownerMemory);
      const logged: Array<[Record<string, unknown>, string]> = [];
      const result = await buildCampaignRoleSet({
        facts,
        profileTitle: null,
        log: (fields, message) => logged.push([fields, message]),
        model: { name: 'gemini-test', propose: async () => answer(modelAnswer, facts[0].ref) },
      });
      const ids = result.roles.map((role) => role.id);

      expect(ids).toEqual(expect.arrayContaining(['eng-mgmt.cto', 'it-ops.cio', ...modelAnswer]));
      expect(result.roles.filter((role) => role.kind === 'primary').map((role) => role.id)).toEqual(['it-ops.vp']);
      expect(result.model).toBe('gemini-test+rules');
      // COO is already in the answer, so of the four strongest three are added.
      expect(logged).toContainEqual([{ kept: 6, added: 3 }, 'campaign-role-model-topped-up']);
    });

    it('роль, убранная кандидатом, не добавляется', async () => {
      const facts = campaignRoleFacts(ownerMemory);
      const result = await buildCampaignRoleSet({
        facts,
        profileTitle: null,
        dismissed: ['eng-mgmt.cto'],
        model: { name: 'gemini-test', propose: async () => answer(modelAnswer, facts[0].ref) },
      });
      const ids = result.roles.map((role) => role.id);

      expect(ids).not.toContain('eng-mgmt.cto');
      expect(ids).toContain('it-ops.cio');
    });

    it('при потолке 10 вытесняются последние роли модели, а основная остаётся', async () => {
      const facts = campaignRoleFacts(ownerMemory);
      const ten = [
        'it-ops.head',
        'support.head',
        'eng.architecture.solutions',
        'consulting.it-consultant.ic',
        'it-ops.vp',
        'ops.vp',
        'product.vp',
        'support.vp',
        'eng-mgmt.vp',
        'eng-mgmt.head',
      ];
      const result = await buildCampaignRoleSet({
        facts,
        profileTitle: null,
        model: { name: 'gemini-test', propose: async () => answer(ten, facts[0].ref, 'eng-mgmt.head') },
      });
      const ids = result.roles.map((role) => role.id);

      expect(ids).toHaveLength(10);
      expect(ids).toEqual(expect.arrayContaining(['eng-mgmt.cto', 'it-ops.cio', 'ops.coo', 'eng-mgmt.head']));
      expect(ids).not.toContain('eng-mgmt.vp');
      expect(ids).not.toContain('support.vp');
      expect(ids).not.toContain('product.vp');
      expect(result.roles.filter((role) => role.kind === 'primary').map((role) => role.id)).toEqual(['eng-mgmt.head']);
    });

    it('роли без должности за ними к ответу модели не добавляются', async () => {
      const skillOnly = [{ ref: 'memory:s', statement: 'Kubernetes, DevOps', domain: 'skill' }];
      const result = await buildCampaignRoleSet({
        facts: skillOnly,
        profileTitle: null,
        model: {
          name: 'gemini-test',
          propose: async ({ candidates }) =>
            answer(candidates.slice(0, 5).map((role) => role.id), 'memory:s'),
        },
      });

      expect(result.roles).toHaveLength(5);
      expect(result.model).toBe('gemini-test');
    });
  });
});
