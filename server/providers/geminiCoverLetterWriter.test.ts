import { describe, expect, it, vi } from 'vitest';
import { buildCoverLetterWriter } from './coverLetterWriter';
import { GeminiCoverLetterWriter } from './geminiCoverLetterWriter';

const input = {
  language: 'en' as const,
  tone: 'executive' as const,
  vacancy: { title: 'SVP of Technical Product Management', company: '2 Hour Learning' },
  facts: [{ ref: 'f1', statement: 'VP of Technology, 250+ people, revenue 4x' }],
};

function geminiReply(body: string, finishReason = 'STOP') {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify({ body }) }] } }],
        }),
        { status: 200 },
      ),
  );
}

describe('GeminiCoverLetterWriter (B266)', () => {
  it('зовёт generateContent через шлюз и принимает целое письмо', async () => {
    const fetchImpl = geminiReply('I led technology at scale. Revenue grew four times.');
    const writer = new GeminiCoverLetterWriter({
      apiKey: 'k',
      model: 'gemini-flash',
      baseUrl: 'https://gateway.example/google-ai-studio/v1beta/',
      stage: 'gemini:gemini-flash',
      extraHeaders: { 'cf-aig-authorization': 'Bearer t' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const outcome = await writer.writeCoverLetter(input);

    expect(outcome).toEqual({
      body: 'I led technology at scale. Revenue grew four times.',
      stage: 'gemini:gemini-flash',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://gateway.example/google-ai-studio/v1beta/models/gemini-flash:generateContent',
    );
    expect((init.headers as Record<string, string>)['cf-aig-authorization']).toBe('Bearer t');
  });

  it('обрезает хвост, оборванный лимитом вывода', async () => {
    const writer = new GeminiCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://g',
      fetchImpl: geminiReply(
        'First sentence. Second sentence. Third is cut at',
        'MAX_TOKENS',
      ) as unknown as typeof fetch,
    });

    await expect(writer.writeCoverLetter(input)).resolves.toMatchObject({
      body: 'First sentence. Second sentence.',
    });
  });

  it('отказ шлюза — это отказ ступени с кодом, а не молчание', async () => {
    const writer = new GeminiCoverLetterWriter({
      apiKey: 'secret',
      model: 'm',
      baseUrl: 'https://g',
      fetchImpl: vi.fn(
        async () => new Response('quota secret exceeded', { status: 429 }),
      ) as unknown as typeof fetch,
    });

    const outcome = await writer.writeCoverLetter(input);

    expect(outcome.failure).toMatchObject({ kind: 'http_error', status: 429 });
    expect(outcome.failure?.detail).not.toContain('secret');
  });

  it('цепочка письма: deepseek-v4.1-flash → luna, Gemini AI Studio (402) в ней нет (28.10)', () => {
    const writer = buildCoverLetterWriter({
      providerCredentials: { openrouter: 'o', gemini: 'g', openai: 'k' },
    }) as unknown as { descriptors: readonly string[] };

    expect(writer.descriptors).toEqual([
      'openrouter:deepseek/deepseek-v4.1-flash',
      'openai:gpt-5.6-luna',
    ]);
  });
});
