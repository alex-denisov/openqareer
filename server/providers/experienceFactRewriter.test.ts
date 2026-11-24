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
      language: 'ru',
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

  it('translates waiting bullets with the translation instructions and strict JSON', async () => {
    const translated = { bullets: [{ key: 'exp-1#0', text: 'Cut tickets by 40%.' }] };
    const { create, client } = clientAnswering(JSON.stringify(translated));
    const rewriter = new LlmExperienceFactRewriter({ apiKey: 'k', model: 'gpt-5.6-luna', client });
    const bullet = {
      key: 'exp-1#0',
      language: 'en' as const,
      text: 'Сократил тикеты на 40%.',
      facts: ['Тикетов стало на 40% меньше.'],
    };
    await expect(rewriter.translate({ bullets: [bullet] })).resolves.toEqual(translated);
    const sent = create.mock.calls[0]![0];
    expect(sent.response_format.json_schema.name).toBe('experience_bullet_translation');
    expect(sent.messages[0].content).toContain('Не усиливай');
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

describe('B645: тексты профиля LinkedIn', () => {
  const linkedin = {
    language: 'ru' as const,
    targetRole: 'Руководитель разработки',
    aboutFacts: [{ id: 'm1', text: 'Вёл команду из 9 человек' }],
    places: [],
  };
  const reply = { about: { text: 'Строю инженерные команды: последняя выросла до 9 человек.', factIds: ['m1'] }, places: [] };

  it('просит строгий JSON с промптом пересказа и читает ответ', async () => {
    const { create, client } = clientAnswering(JSON.stringify(reply));
    const rewriter = new LlmExperienceFactRewriter({ apiKey: 'k', model: 'gpt-5.6-luna', client });
    await expect(rewriter.linkedinProfile(linkedin)).resolves.toEqual(reply);
    const sent = create.mock.calls[0]![0];
    expect(sent.response_format.json_schema).toMatchObject({ name: 'linkedin_profile_rewrite', strict: true });
    expect(sent.messages[0].content).toContain('Пиши заново, своими словами');
    expect(sent.messages[1].content).toContain('Вёл команду из 9 человек');
  });

  it('очередь пропускает упавшую и пустую ступень', async () => {
    const failures: string[] = [];
    const stage = (model: string, result: () => Promise<unknown>) => ({
      provenance: { model, promptRevision: 'r' },
      rewrite: async () => null,
      linkedinProfile: vi.fn(result) as never,
    });
    const queue = new QueuedExperienceFactRewriter(
      [
        stage('a', () => Promise.reject(new Error('timeout'))),
        stage('b', () => Promise.resolve({ about: { text: ' ', factIds: [] }, places: [] })),
        stage('c', () => Promise.resolve(reply)),
      ],
      (model) => failures.push(model),
    );
    await expect(queue.linkedinProfile(linkedin)).resolves.toEqual(reply);
    expect(failures).toEqual(['a', 'b']);
  });

  it('B645: другой вариант — своя схема и промпт; очередь пропускает пустой ответ', async () => {
    const variant = { target: 'about', language: 'ru', targetRole: 'CTO', facts: [{ id: 'm1', text: 'Вёл команду из 9 человек' }], avoid: ['Старый'] } as const;
    const answer = { text: 'Новый вариант', factIds: ['m1'] };
    const { create, client } = clientAnswering(JSON.stringify(answer));
    const rewriter = new LlmExperienceFactRewriter({ apiKey: 'k', model: 'gpt-5.6-luna', client });
    await expect(rewriter.linkedinVariant(variant)).resolves.toEqual(answer);
    const sent = create.mock.calls[0]![0];
    expect(sent.response_format.json_schema).toMatchObject({ name: 'linkedin_profile_variant', strict: true });
    expect(sent.messages[1].content).toContain('Старый');
    const failures: string[] = [];
    const stage = (model: string, result: unknown) => ({
      provenance: { model, promptRevision: 'r' }, rewrite: async () => null, linkedinVariant: vi.fn(async () => result) as never,
    });
    const queue = new QueuedExperienceFactRewriter([stage('a', { text: ' ', factIds: [] }), stage('b', answer)], (model) => failures.push(model));
    await expect(queue.linkedinVariant(variant)).resolves.toEqual(answer);
    expect(failures).toEqual(['a']);
  });

  it('B682: вариант резюме — своя схема; очередь пропускает пустой ответ', async () => {
    const request = { target: 'about', language: 'ru', vacancyTitle: 'CTO', facts: [{ id: 'f1', text: 'Вёл команду' }], keep: [], avoid: ['Старый'] } as const;
    const answer = { text: 'Новый', factIds: ['f1'] };
    const { create, client } = clientAnswering(JSON.stringify(answer));
    const rewriter = new LlmExperienceFactRewriter({ apiKey: 'k', model: 'gpt-5.6-luna', client });
    await expect(rewriter.hhResumeVariant(request)).resolves.toEqual(answer);
    expect(create.mock.calls[0]![0].response_format.json_schema).toMatchObject({ name: 'hh_resume_variant', strict: true });
    const stage = (result: unknown) => ({ rewrite: async () => null, hhResumeVariant: async () => result as never });
    const queue = new QueuedExperienceFactRewriter([stage({ text: ' ', factIds: [] }), stage(answer)], () => undefined);
    await expect(queue.hhResumeVariant(request)).resolves.toEqual(answer);
  });
});
