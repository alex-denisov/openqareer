import { describe, expect, it, vi } from 'vitest';
import {
  LlmLinkedinDraftWriter,
  QueuedLinkedinDraftWriter,
  buildLinkedinDraftWriter,
} from './linkedinDraftWriter';
const input = {
  kind: 'post' as const,
  topic: 'Мой опыт',
  profileHeadline: 'Руководитель',
  facts: [{ ref: 'f1', statement: 'Создал команду' }],
};
describe('LinkedIn draft writer', () => {
  it('returns model text with a strict JSON schema and candidate facts', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ choices: [{ message: { content: '{"text":"Я создал команду."}' } }] });
    const writer = new LlmLinkedinDraftWriter({
      apiKey: 'fake',
      model: 'fake',
      client: { chat: { completions: { create } } },
    });
    await expect(writer.writeDraft(input)).resolves.toEqual({ text: 'Я создал команду.' });
    expect(create.mock.calls[0][0].response_format.json_schema.strict).toBe(true);
    expect(JSON.parse(create.mock.calls[0][0].messages[1].content).facts).toEqual(input.facts);
  });
});

it('clips a long comment at a complete sentence', async () => {
  const text = 'Я создал команду. Я делюсь опытом. ' + 'Длинный хвост '.repeat(60);
  const create = vi
    .fn()
    .mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ text }) } }] });
  const writer = new LlmLinkedinDraftWriter({
    apiKey: 'fake',
    model: 'fake',
    client: { chat: { completions: { create } } },
  });
  await expect(writer.writeDraft({ ...input, kind: 'comment' })).resolves.toEqual({
    text: 'Я создал команду. Я делюсь опытом.',
  });
});
it('reports unavailable when no provider is configured', async () => {
  await expect(buildLinkedinDraftWriter({}).writeDraft(input)).rejects.toMatchObject({
    code: 'draft_writer_unavailable',
  });
});
it('stops waiting when the common budget expires', async () => {
  const stage = { writeDraft: () => new Promise<{ text: string }>(() => undefined) };
  await expect(new QueuedLinkedinDraftWriter([stage], 5).writeDraft(input)).rejects.toMatchObject({
    code: 'draft_writer_unavailable',
  });
});
it('uses Gemini JSON transport for candidate drafts', async () => {
  const { GeminiLinkedinDraftWriter } = await import('./linkedinDraftWriter');
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"text":"Я создал команду."}' }] } }],
      }),
      { status: 200 },
    ),
  );
  const writer = new GeminiLinkedinDraftWriter({
    apiKey: 'fake',
    model: 'fake',
    baseUrl: 'https://example.test',
    fetchImpl,
  });
  await expect(writer.writeDraft(input)).resolves.toEqual({ text: 'Я создал команду.' });
  expect(
    JSON.parse(fetchImpl.mock.calls[0][1].body).generationConfig.responseJsonSchema
      .additionalProperties,
  ).toBe(false);
});
it('rejects invalid model JSON through the public writer error', async () => {
  const create = vi
    .fn()
    .mockResolvedValue({ choices: [{ message: { content: '{"text":"","extra":true}' } }] });
  const writer = new LlmLinkedinDraftWriter({
    apiKey: 'fake',
    model: 'fake',
    client: { chat: { completions: { create } } },
  });
  await expect(writer.writeDraft(input)).rejects.toMatchObject({
    code: 'draft_writer_unavailable',
  });
});
it('falls back to the next configured writer after a provider refusal', async () => {
  const first = { writeDraft: vi.fn().mockRejectedValue(new Error('refused')) };
  const second = { writeDraft: vi.fn().mockResolvedValue({ text: 'Я создал команду.' }) };
  await expect(new QueuedLinkedinDraftWriter([first, second]).writeDraft(input)).resolves.toEqual({
    text: 'Я создал команду.',
  });
});
it('clips a long post at the last complete sentence within 1300 characters', async () => {
  const text = 'Я создал команду. Я делюсь опытом. ' + 'Следующее предложение '.repeat(90);
  const create = vi
    .fn()
    .mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ text }) } }] });
  const writer = new LlmLinkedinDraftWriter({
    apiKey: 'fake',
    model: 'fake',
    client: { chat: { completions: { create } } },
  });
  await expect(writer.writeDraft(input)).resolves.toEqual({
    text: 'Я создал команду. Я делюсь опытом.',
  });
});
it('does not call a fallback after the total writing budget expires', async () => {
  vi.useFakeTimers();
  try {
    const first = {
      writeDraft: vi
        .fn()
        .mockImplementation(
          () => new Promise((_, reject) => setTimeout(() => reject(new Error('late refusal')), 30)),
        ),
    };
    const fallback = { writeDraft: vi.fn().mockResolvedValue({ text: 'Я создал команду.' }) };
    const writing = new QueuedLinkedinDraftWriter([first, fallback], 10).writeDraft(input);
    const rejected = expect(writing).rejects.toMatchObject({ code: 'draft_writer_unavailable' });
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    await vi.advanceTimersByTimeAsync(30);
    expect(fallback.writeDraft).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
