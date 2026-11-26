import { describe, expect, it, vi } from 'vitest';
import type { NamedRole } from '../../shared/roleProposals';
import {
  buildRoleNamer,
  LlmRoleNamer,
  roleTitleTranslatorOf,
  type ChatCompletionClient,
  type RoleNamer,
} from './roleNamer';
import { TitleRuRetryRoleNamer, type RoleTitleTranslator } from './roleTitleRuRetry';

function client(content: string): ChatCompletionClient {
  return {
    chat: {
      completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }) },
    },
  };
}

const facts = [{ ref: 'memory:1', statement: 'Основал практику AI-консалтинга' }];
const role = (title: string, titleRu?: string): NamedRole => ({
  title,
  ...(titleRu ? { titleRu } : {}),
  reason: 'опыт',
  evidenceRefs: ['memory:1'],
});

describe('B748: перевод роли от модели доходит до ролей', () => {
  it('LlmRoleNamer отдаёт проверенный titleRu, а не теряет его', async () => {
    const namer = new LlmRoleNamer({
      apiKey: 'k',
      model: 'm',
      client: client(
        JSON.stringify({
          roles: [
            {
              title: 'AI Consultant',
              titleRu: 'AI-консультант',
              reason: 'опыт',
              evidenceRefs: ['memory:1'],
            },
            {
              title: 'Transformation Director',
              titleRu: 'Transformation Director',
              reason: 'опыт',
              evidenceRefs: ['memory:1'],
            },
          ],
        }),
      ),
    });
    const outcome = await namer.nameRoles(facts, 'en');
    expect(outcome.roles.map((r) => [r.title, r.titleRu])).toEqual([
      ['AI Consultant', 'ИИ-консультант'],
      ['Transformation Director', undefined],
    ]);
  });

  it('LlmRoleNamer переводит пачку названий одним вызовом и проверяет каждый перевод', async () => {
    const stub = client(
      JSON.stringify({
        titles: [
          { title: 'Transformation Director', titleRu: 'Директор по трансформации' },
          { title: 'IT Operations Director', titleRu: 'Operations Director' },
        ],
      }),
    );
    const namer = new LlmRoleNamer({ apiKey: 'k', model: 'm', client: stub });
    await expect(
      namer.translateTitles(['Transformation Director', 'IT Operations Director']),
    ).resolves.toEqual({ 'Transformation Director': 'Директор по трансформации' });
    expect(stub.chat.completions.create).toHaveBeenCalledTimes(1);
  });
});

describe('B748: вторая проверенная попытка только для отвергнутых названий', () => {
  function inner(roles: NamedRole[]): RoleNamer {
    return { nameRoles: vi.fn().mockResolvedValue({ roles, stage: 'm' }) };
  }

  it('спрашивает перевод одной пачкой только у ролей без русского названия и вне онтологии', async () => {
    const translator: RoleTitleTranslator = {
      translateTitles: vi.fn().mockResolvedValue({ 'AI Consultant': 'AI-консультант' }),
    };
    const namer = new TitleRuRetryRoleNamer({
      inner: inner([
        role('COO', 'Операционный директор (COO)'),
        role('Chief Technology Officer'),
        role('AI Consultant'),
        role('Transformation Director'),
      ]),
      translator,
      needsTranslation: (title) => title !== 'Chief Technology Officer',
    });
    const outcome = await namer.nameRoles(facts, 'en');
    expect(translator.translateTitles).toHaveBeenCalledWith([
      'AI Consultant',
      'Transformation Director',
    ]);
    expect(outcome.roles.map((r) => [r.title, r.titleRu])).toEqual([
      ['COO', 'Операционный директор (COO)'],
      ['Chief Technology Officer', undefined],
      ['AI Consultant', 'AI-консультант'],
      // Отвергнут второй раз — остаётся английское, без выдуманного перевода.
      ['Transformation Director', undefined],
    ]);
  });

  it('все роли уже по-русски — второго вызова нет; сбой перевода не теряет роли', async () => {
    const quiet: RoleTitleTranslator = { translateTitles: vi.fn() };
    await new TitleRuRetryRoleNamer({
      inner: inner([role('COO', 'Операционный директор (COO)')]),
      translator: quiet,
      needsTranslation: () => true,
    }).nameRoles(facts, 'en');
    expect(quiet.translateTitles).not.toHaveBeenCalled();

    const failing: RoleTitleTranslator = {
      translateTitles: vi.fn().mockRejectedValue(new Error('503')),
    };
    const outcome = await new TitleRuRetryRoleNamer({
      inner: inner([role('AI Consultant')]),
      translator: failing,
      needsTranslation: () => true,
    }).nameRoles(facts, 'en');
    expect(outcome.roles.map((r) => r.title)).toEqual(['AI Consultant']);
  });
});

describe('B748: фоновый проход берёт тот же проверенный перевод', () => {
  it('из собранной цепочки называния, а без ключей — никакого', () => {
    const namer = buildRoleNamer({ providerCredentials: { openrouter: 'k' } });
    expect(roleTitleTranslatorOf(namer)).toBeDefined();
    expect(roleTitleTranslatorOf(undefined)).toBeUndefined();
  });
});
