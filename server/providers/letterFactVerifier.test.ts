import { describe, expect, it, vi } from 'vitest';
import { QueuedCoverLetterWriter, type CoverLetterWriteInput, type CoverLetterWriter } from './coverLetterWriter';
import { LlmLetterFactVerifier, type LetterCheckStage, type LetterFactVerifier } from './letterFactVerifier';
import type { ChatCompletionClient } from './roleNamer';

const INPUT: CoverLetterWriteInput = {
  facts: [{ ref: 'f1', statement: 'Команда выросла с 8 до 35 человек', workplace: 'Ритейл Системс' }],
  vacancy: { title: 'VP', company: 'Bjak', description: 'Run operating reviews.' },
  language: 'ru',
  tone: 'executive',
};

function stageAnswering(content: string | Error): { stage: LetterCheckStage; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => {
    if (content instanceof Error) throw content;
    return { choices: [{ message: { content } }] };
  });
  const client = { chat: { completions: { create } } } as unknown as ChatCompletionClient;
  return { stage: { apiKey: 'k', model: 'm', stage: 'test', client, openAiStyleLimit: true }, create };
}

const BODY = 'Роль про обзоры. Команда выросла с 8 до 35 человек.';

describe('LlmLetterFactVerifier', () => {
  it('sends each sentence and the same source the writer saw', async () => {
    const { stage, create } = stageAnswering('{"sentences":[{"n":1,"supported":true,"rule":""},{"n":2,"supported":true,"rule":""}]}');
    await expect(new LlmLetterFactVerifier([stage]).verify(BODY, INPUT)).resolves.toEqual({ status: 'supported' });
    const sent = JSON.parse((create.mock.calls[0]![0] as { messages: { content: string }[] }).messages[1]!.content);
    expect(sent.letter.map((line: { n: number }) => line.n)).toEqual([1, 2]);
    expect(sent.source.facts[0].workplace).toBe('Ритейл Системс');
    expect(sent.source.vacancy.description).toBe('Run operating reviews.');
  });

  it('one unsupported sentence rejects the letter and names only rules', async () => {
    const { stage } = stageAnswering('{"sentences":[{"n":1,"supported":true,"rule":""},{"n":2,"supported":false,"rule":"stronger_role"}]}');
    await expect(new LlmLetterFactVerifier([stage]).verify(BODY, INPUT)).resolves.toEqual({ status: 'rejected', rules: ['stronger_role'] });
  });

  it('an unknown rule still rejects', async () => {
    const { stage } = stageAnswering('{"sentences":[{"n":1,"supported":false,"rule":"Тут всё выдумано про Ритейл"},{"n":2,"supported":true,"rule":""}]}');
    await expect(new LlmLetterFactVerifier([stage]).verify(BODY, INPUT)).resolves.toEqual({ status: 'rejected', rules: ['invented'] });
  });

  it('a sentence left without an answer is not checked', async () => {
    const { stage } = stageAnswering('{"sentences":[{"n":1,"supported":true,"rule":""}]}');
    const verdict = await new LlmLetterFactVerifier([stage]).verify(BODY, INPUT);
    expect(verdict.status).toBe('unavailable');
  });

  it('goes to the next stage when one fails, and is unavailable when all do', async () => {
    const broken = stageAnswering(new Error('boom'));
    const good = stageAnswering('{"sentences":[{"n":1,"supported":true,"rule":""},{"n":2,"supported":true,"rule":""}]}');
    await expect(new LlmLetterFactVerifier([broken.stage, good.stage]).verify(BODY, INPUT)).resolves.toEqual({ status: 'supported' });
    const verdict = await new LlmLetterFactVerifier([broken.stage]).verify(BODY, INPUT);
    expect(verdict.status).toBe('unavailable');
    expect(JSON.stringify(verdict)).not.toContain('boom');
  });
});

describe('QueuedCoverLetterWriter with the second check', () => {
  const writer = (body: string, stage: string): CoverLetterWriter => ({ writeCoverLetter: async () => ({ body, stage }) });
  const verifierFor = (verdicts: readonly Awaited<ReturnType<LetterFactVerifier['verify']>>[]): LetterFactVerifier => {
    let index = 0;
    return { verify: async () => verdicts[Math.min(index++, verdicts.length - 1)]! };
  };

  it('a rejected letter goes to the next stage, its text never reaches the log', async () => {
    const failures: unknown[] = [];
    const queue = new QueuedCoverLetterWriter(
      [writer('Секретный текст письма.', 'a'), writer('Второе письмо.', 'b')],
      [],
      (failure) => failures.push(failure),
      verifierFor([{ status: 'rejected', rules: ['invented'] }, { status: 'supported' }]),
    );
    await expect(queue.writeCoverLetter(INPUT)).resolves.toEqual({ body: 'Второе письмо.', stage: 'b' });
    expect(JSON.stringify(failures)).toContain('letter_check:invented');
    expect(JSON.stringify(failures)).not.toContain('Секретный');
  });

  it('every stage rejected leaves no body: the route falls back to the template', async () => {
    const queue = new QueuedCoverLetterWriter([writer('Письмо.', 'a')], [], () => undefined, verifierFor([{ status: 'rejected', rules: ['wrong_place'] }]));
    const outcome = await queue.writeCoverLetter(INPUT);
    expect(outcome.body).toBeUndefined();
  });

  it('a check that cannot answer stops the chain: no unchecked letter and no wasted stages', async () => {
    const second = vi.fn(async () => ({ body: 'Второе.', stage: 'b' }));
    const queue = new QueuedCoverLetterWriter(
      [writer('Письмо.', 'a'), { writeCoverLetter: second }],
      [],
      () => undefined,
      verifierFor([{ status: 'unavailable', detail: 'test:TimeoutError' }]),
    );
    const outcome = await queue.writeCoverLetter(INPUT);
    expect(outcome.body).toBeUndefined();
    expect(second).not.toHaveBeenCalled();
  });
});
