import { describe, expect, it, vi } from 'vitest';
import {
  buildCampaignRoleModel,
  ChatCampaignRoleModel,
  QueuedCampaignRoleModel,
  VertexCampaignRoleModel,
} from './campaignRoleModel';
import type { CampaignRoleModel } from '../vacancies/campaignRoleSet';

const vertex = {
  projectId: 'p',
  clientEmail: 'bot@p.iam.gserviceaccount.com',
  privateKey: 'unused-in-this-test',
  model: 'gemini-3.8-flash',
  location: 'global',
};
const input = { facts: [], candidates: [] };
const roles = Array.from({ length: 5 }, (_, index) => ({ id: `r${index}` }));

describe('цепочка ролей кампании (28.10)', () => {
  it('deepseek-v4-flash → glm-5.3-flash → Vertex (B580)', () => {
    const model = buildCampaignRoleModel({
      providerCredentials: { openrouter: 'sk-or-test', openai: 'sk-openai-test' },
      vertex,
    }) as QueuedCampaignRoleModel;

    expect(model.stages.at(-1)).toBeInstanceOf(VertexCampaignRoleModel);
    expect(model.stages.map((stage) => stage.name)).toEqual([
      'deepseek/deepseek-v4-flash',
      'z-ai/glm-5.3-flash',
      'gemini-3.8-flash',
    ]);
  });

  it('без ключей и Vertex модели нет — работают правила', () => {
    expect(buildCampaignRoleModel({ providerCredentials: {} })).toBeUndefined();
  });

  it('сбой и негодный ответ ведут к следующей ступени, имя — у ответившей', async () => {
    const stage = (name: string, answer: () => Promise<unknown>): CampaignRoleModel => ({
      name,
      propose: vi.fn(answer),
    });
    const stages = [
      stage('vertex', async () => {
        throw new Error('429');
      }),
      stage('deepseek', async () => [{ id: 'one' }]),
      stage('glm', async () => roles),
    ];
    const queued = new QueuedCampaignRoleModel(stages);

    expect(await queued.propose(input)).toEqual(roles);
    expect(queued.name).toBe('glm');
  });

  it('все ступени отказали — ошибка, и набор строят правила', async () => {
    const queued = new QueuedCampaignRoleModel([
      { name: 'a', propose: async () => null },
      {
        name: 'b',
        propose: async () => {
          throw new Error('503');
        },
      },
    ]);
    await expect(queued.propose(input)).rejects.toThrow('503');
  });

  it('ступень chat-completions разворачивает { roles } и просит JSON без рассуждения', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: JSON.stringify({ roles }) } }] }),
    );
    const model = new ChatCampaignRoleModel(
      { provider: 'openrouter', apiKey: 'k', model: 'deepseek/deepseek-v4.1-flash' },
      fetchImpl as unknown as typeof fetch,
    );

    expect(await model.propose(input)).toEqual(roles);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek/deepseek-v4.1-flash',
      response_format: { type: 'json_object' },
      reasoning: { enabled: false },
    });
  });
});
