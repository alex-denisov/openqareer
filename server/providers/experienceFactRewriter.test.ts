import { describe, expect, it, vi } from 'vitest';
import type { FactRewriteRequest } from '../domain/experienceFactRewrite';
import {
  buildExperienceFactRewriter,
  LlmExperienceFactRewriter,
  QueuedExperienceFactRewriter,
  readModelOutput,
} from './experienceFactRewriter';

const request: FactRewriteRequest = {
  places: [
    {
      experienceId: 'exp-1',
      employer: 'Cloud',
      title: 'Head',
      period: '2020 — 2023',
      existingBullets: [],
    },
  ],
  facts: [{ id: 'f-1', domain: 'outcome', statement: 'Тикетов стало на 40% меньше.' }],
};
const answer = {
  places: [
    {
      experienceId: 'exp-1',
      bullets: [{ text: 'Сократил тикеты на 40%.', sourceFactIds: ['f-1'] }],
    },
  ],
  droppedFactIds: [],
  unmatchedFactIds: [],
};

function clientAnswering(content: string) {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content } }] });
  return { create, client: { chat: { completions: { create } } } };
}

describe('LlmExperienceFactRewriter', () => {
  it('asks for strict JSON with the rewrite instructions and reads the answer', async () => {
    const { create, client } = clientAnswering(JSON.stringify(answer));
    const rewriter = new LlmExperienceFactRewriter({ apiKey: 'k', model: 'gpt-5.6-luna', client });
    await expect(rewriter.rewrite(request)).resolves.toEqual(answer);
    const sent = create.mock.calls[0]![0];
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.messages[0].content).toContain('пункты резюме');
    expect(sent.messages[1].content).toContain('Тикетов стало на 40% меньше.');
  });

  it('does not call the model without facts', async () => {
    const { create, client } = clientAnswering('{}');
    const rewriter = new LlmExperienceFactRewriter({ apiKey: 'k', model: 'm', client });
    await expect(rewriter.rewrite({ ...request, facts: [] })).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('reads JSON wrapped in prose and refuses a malformed answer', () => {
    expect(readModelOutput(`Вот ответ:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``)).toEqual(
      answer,
    );
    expect(readModelOutput('{"places": "нет"}')).toBeNull();
    expect(readModelOutput('нет JSON')).toBeNull();
  });
});

describe('QueuedExperienceFactRewriter', () => {
  it('moves on when a stage throws or answers nothing usable', async () => {
    const failures: string[] = [];
    const stage = (model: string, result: () => Promise<unknown>) => ({
      provenance: { model, promptRevision: 'r' },
      rewrite: vi.fn(result) as never,
    });
    const queue = new QueuedExperienceFactRewriter(
      [
        stage('a', () => Promise.reject(new Error('timeout'))),
        stage('b', () => Promise.resolve(null)),
        stage('c', () => Promise.resolve(answer)),
      ],
      (model) => failures.push(model),
    );
    await expect(queue.rewrite(request)).resolves.toEqual(answer);
    expect(failures).toEqual(['a', 'b']);
    expect(queue.provenance?.model).toBe('c');
  });

  it('treats an answer without a single bullet as a failed stage', async () => {
    const failures: string[] = [];
    const empty = { places: [], droppedFactIds: ['f-1'], unmatchedFactIds: [] };
    const queue = new QueuedExperienceFactRewriter(
      [
        { provenance: { model: 'empty', promptRevision: 'r' }, rewrite: async () => empty },
        { provenance: { model: 'good', promptRevision: 'r' }, rewrite: async () => answer },
      ],
      (model) => failures.push(model),
    );
    await expect(queue.rewrite(request)).resolves.toEqual(answer);
    expect(failures).toEqual(['empty']);
  });

  it('is not built without a paid route', () => {
    expect(buildExperienceFactRewriter({ providerCredentials: {} })).toBeUndefined();
    const built = buildExperienceFactRewriter({
      providerCredentials: { openai: 'sk-openai-test-key-long-enough' },
    });
    expect(built?.provenance?.model).toBe('gpt-5.6-luna');
  });
});
