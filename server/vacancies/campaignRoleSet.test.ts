import { describe, expect, it } from 'vitest';
import { buildCampaignRoleSet, type CampaignRoleModel } from './campaignRoleSet';

const facts = [
  { ref: 'memory:title', statement: 'VP of Technology & Operations' },
  { ref: 'memory:vp', statement: 'VP Engineering: led platform and engineering' },
  { ref: 'memory:coo', statement: 'COO: owned operations and delivery' },
] as const;

describe('buildCampaignRoleSet (B267 S5)', () => {
  it('на фиктивной модели принимает 5–10 ролей только из кандидатного набора', async () => {
    const model: CampaignRoleModel = {
      propose: async ({ candidates }) => candidates.slice(0, 6).map((role, index) => ({
        id: role.id,
        level: role.levels.at(-1)!,
        kind: index === 0 ? 'primary' : 'adjacent',
        evidenceRefs: [facts[index % facts.length].ref],
        reason: 'Подтверждено фактом профиля',
      })),
    };
    const result = await buildCampaignRoleSet({ facts, profileTitle: facts[0].statement, model });

    expect(result.roles).toHaveLength(6);
    expect(result.roles[0].kind).toBe('primary');
    expect(result.roles.every((role) => role.title && role.titleRu && role.evidenceRefs.length > 0)).toBe(true);
  });

  it('отбрасывает весь ответ модели с чужим id или без evidenceRefs', async () => {
    for (const bad of [
      [{ id: 'outside.role', level: 'vp', kind: 'primary', evidenceRefs: ['memory:title'], reason: 'x' }],
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
});
