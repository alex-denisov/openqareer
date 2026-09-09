import { describe, expect, it } from 'vitest';
import { HygienicRoleNamer } from './hygienicRoleNamer';

/**
 * Названия ролей печатаются кандидату и уходят в подбор вакансий. Метка внутри
 * названия делает две одинаковые роли разными строками (B210, B191).
 */
describe('HygienicRoleNamer', () => {
  it('снимает невидимые метки с названий ролей', async () => {
    const namer = new HygienicRoleNamer({
      inner: {
        nameRoles: async () => ({
          roles: [{ title: 'Ведущий​инженер данных', reason: 'вёл витрину данных', evidenceRefs: [] }],
          stage: 'openai:gpt-5',
        }),
      },
    });
    const outcome = await namer.nameRoles([], 'ru');
    expect(outcome.roles[0].title).toBe('Ведущийинженер данных');
  });

  it('не трогает ступень и причины молчания — по ним разбирают инциденты', async () => {
    const failures = [{ stage: 'gemini:pro', kind: 'http_error' as const, status: 429 }];
    const namer = new HygienicRoleNamer({
      inner: { nameRoles: async () => ({ roles: [], stage: 'gemini:pro', failures }) },
    });
    const outcome = await namer.nameRoles([], 'ru');
    expect(outcome.stage).toBe('gemini:pro');
    expect(outcome.failures).toBe(failures);
  });

  it('чистый ответ возвращается тем же объектом', async () => {
    const answer = { roles: [{ title: 'Инженер данных', reason: 'вёл витрину данных', evidenceRefs: [] }], stage: 'openai:gpt-5' };
    const namer = new HygienicRoleNamer({ inner: { nameRoles: async () => answer } });
    await expect(namer.nameRoles([], 'ru')).resolves.toBe(answer);
  });
});
