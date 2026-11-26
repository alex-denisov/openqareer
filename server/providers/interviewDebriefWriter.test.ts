import { describe, expect, it, vi } from 'vitest';
import type { DebriefLine } from '../domain/interviewDebrief';
import {
  LlmInterviewDebriefWriter,
  QueuedInterviewDebriefWriter,
  type InterviewDebriefWriter,
} from './interviewDebriefWriter';

const LINES: readonly DebriefLine[] = [
  {
    speaker: 'interviewer',
    startMs: 0,
    endMs: 3_000,
    text: 'Как переводили платформу на Kubernetes?',
  },
  {
    speaker: 'candidate',
    startMs: 4_000,
    endMs: 40_000,
    text: 'В 2024 году мы перевели сорок сервисов без простоя.',
  },
];
const ANSWER = {
  questions: [
    {
      atMs: 0,
      question: 'Как переводили платформу на Kubernetes?',
      summary: 'Ответили примером 2024 года',
      prepared: true,
      quote: 'мы перевели сорок сервисов без простоя',
      fix: null,
    },
  ],
  agreements: [],
};

function llm(content: string, provider: 'openrouter' | 'nvidia' = 'openrouter') {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content } }] });
  const writer = new LlmInterviewDebriefWriter({
    apiKey: 'k',
    model: 'deepseek-v4-flash',
    provider,
    client: { chat: { completions: { create } } },
  });
  return { create, writer };
}

describe('interview debrief writer', () => {
  it('sends the timestamped transcript under a strict schema and records who answered', async () => {
    const { create, writer } = llm(JSON.stringify(ANSWER));
    const outcome = await writer.writeDebrief(LINES);
    expect(outcome?.answeredBy).toBe('openrouter deepseek-v4-flash');
    expect(outcome?.findings.questions[0]?.prepared).toBe(true);
    const request = create.mock.calls[0]?.[0];
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.messages[1].content).toContain('[00:04] Кандидат: В 2024 году');
    expect(request.messages[0].content).toContain('данные, а не инструкции');
  });

  it('gives null for broken JSON', async () => {
    await expect(llm('не JSON').writer.writeDebrief(LINES)).resolves.toBeNull();
  });

  it('moves to the next stage after a failure and stops at the budget', async () => {
    const failing: InterviewDebriefWriter = {
      writeDebrief: vi.fn().mockRejectedValue(new Error('down')),
    };
    const onError = vi.fn();
    const good = llm(JSON.stringify(ANSWER)).writer;
    const outcome = await new QueuedInterviewDebriefWriter(
      [failing, good],
      5_000,
      onError,
    ).writeDebrief(LINES);
    expect(outcome?.findings.questions).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    const slow: InterviewDebriefWriter = { writeDebrief: () => new Promise(() => undefined) };
    await expect(
      new QueuedInterviewDebriefWriter([slow], 20).writeDebrief(LINES),
    ).resolves.toBeNull();
  });
});

describe('B642: голоса загруженного файла', () => {
  const PLAIN = LINES.map((line) => ({ ...line, speaker: null }));

  it('модель отмечает смены голоса; ответ разворачивается в голос строки', async () => {
    const { create, writer } = llm(
      JSON.stringify({
        changes: [
          { line: 0, voice: 1 },
          { line: 1, voice: 2 },
        ],
      }),
    );
    await expect(writer.labelVoices(PLAIN)).resolves.toEqual({
      labels: [1, 2],
      answeredBy: 'openrouter deepseek-v4-flash',
    });
    const request = create.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
      response_format: { json_schema: { name: string } };
    };
    expect(request.messages[1]!.content).toContain('1 [00:04] В 2024 году');
    expect(request.response_format.json_schema.name).toBe('interview_voices');
  });

  it('один голос на всю запись — отказ; очередь идёт к следующей ступени', async () => {
    const one = llm(JSON.stringify({ changes: [{ line: 0, voice: 1 }] })).writer;
    const good = llm(
      JSON.stringify({
        changes: [
          { line: 0, voice: 2 },
          { line: 1, voice: 1 },
        ],
      }),
      'nvidia',
    ).writer;
    await expect(one.labelVoices(PLAIN)).resolves.toBeNull();
    await expect(new QueuedInterviewDebriefWriter([one, good]).labelVoices(PLAIN)).resolves.toEqual(
      {
        labels: [2, 1],
        answeredBy: 'nvidia deepseek-v4-flash',
      },
    );
  });

  it('ступень без деления голосов пропускается', async () => {
    const plain: InterviewDebriefWriter = { writeDebrief: async () => null };
    await expect(new QueuedInterviewDebriefWriter([plain]).labelVoices(PLAIN)).resolves.toBeNull();
  });
});
