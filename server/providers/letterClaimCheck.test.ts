import { describe, expect, it, vi } from 'vitest';
import { LlmLetterClaimCheck } from './letterClaimCheck';
import { QueuedCoverLetterWriter } from './coverLetterWriter';
import type { ChatCompletionClient } from './roleNamer';

const input = {
  facts: [{ ref: 'a', statement: 'Команда выросла с 8 до 35 человек.' }],
  vacancy: { title: 'CTO' },
  language: 'ru' as const,
  tone: 'executive' as const,
};

function replies(...answers: Array<string | Error>): ChatCompletionClient & { calls: () => string[] } {
  const queue = [...answers];
  const create = vi.fn(async (_request: Record<string, unknown>) => {
    const next = queue.shift();
    if (next === undefined || next instanceof Error) throw next ?? new Error('no reply');
    return { choices: [{ message: { content: next } }] };
  });
  return {
    chat: { completions: { create } },
    calls: () => create.mock.calls.map(([request]) => String((request.messages as Array<{ content: string }>)[1]?.content)),
  };
}

const check = (client: ChatCompletionClient) => new LlmLetterClaimCheck({ apiKey: 'k', model: 'm', stage: 's', client });
const BODY = 'Обычно ломается на стыках. Я вырастил команду с 8 до 35 человек. Предлагаю созвониться.';

describe('LlmLetterClaimCheck', () => {
  it('passes a letter the check has no issue with', async () => {
    const client = replies('{"issues":[]}');
    await expect(check(client).settle(BODY, input)).resolves.toEqual({ body: BODY, flagged: 0 });
  });

  it('does not call the model when the letter says nothing about the candidate', async () => {
    const client = replies();
    const opinion = 'Обычно ломается на стыках.';
    await expect(check(client).settle(opinion, input)).resolves.toEqual({ body: opinion, flagged: 0 });
    expect(client.calls()).toEqual([]);
  });

  it('fixes the named sentence, leaves the rest and checks the new sentence again', async () => {
    const client = replies(
      '{"issues":[{"n":2,"kind":"actor","why":"команда выросла"}]}',
      '{"fixes":[{"n":2,"text":"Команда выросла с 8 до 35 человек."}]}',
      '{"issues":[]}',
    );
    await expect(check(client).settle(BODY, input)).resolves.toEqual({
      body: 'Обычно ломается на стыках. Команда выросла с 8 до 35 человек. Предлагаю созвониться.',
      flagged: 1,
    });
    expect(client.calls()[1]).toContain('2. Я вырастил команду');
    expect(client.calls()[1]).toContain('команда выросла');
  });

  it('ignores an issue on a sentence it was not asked about', async () => {
    const client = replies('{"issues":[{"n":1,"kind":"invented","why":"мнение"}]}');
    await expect(check(client).settle(BODY, input)).resolves.toEqual({ body: BODY, flagged: 0 });
  });

  it('removes a sentence whose fix fails the check again, the letter stays', async () => {
    const client = replies(
      '{"issues":[{"n":3,"kind":"actor","why":"x"}]}',
      '{"fixes":[{"n":3,"text":"Я снова вырастил команду."}]}',
      '{"issues":[{"n":3,"kind":"actor","why":"секрет"}]}',
    );
    const body = 'Обычно ломается на стыках. Ещё одно мнение. Я вырастил команду с 8 до 35 человек. Предлагаю созвониться.';
    await expect(check(client).settle(body, input)).resolves.toEqual({
      body: 'Обычно ломается на стыках. Ещё одно мнение. Предлагаю созвониться.',
      flagged: 1,
    });
  });

  it('refuses a letter left too short after the removal', async () => {
    const client = replies(
      '{"issues":[{"n":2,"kind":"actor","why":"x"}]}',
      '{"fixes":[{"n":2,"text":"Я снова вырастил команду."}]}',
      '{"issues":[{"n":2,"kind":"actor","why":"секрет"}]}',
    );
    await expect(check(client).settle(BODY, input)).resolves.toEqual({ detail: 'letter_claims:too_short' });
  });

  it('refuses a letter when the check gives no answer: unchecked text is not shown', async () => {
    await expect(check(replies(new Error('down'))).settle(BODY, input)).resolves.toEqual({ detail: 'letter_claims:unavailable' });
    await expect(check(replies('не json')).settle(BODY, input)).resolves.toEqual({ detail: 'letter_claims:unavailable' });
  });

  it('refuses a letter when the fix gives no answer', async () => {
    const client = replies('{"issues":[{"n":2,"kind":"actor","why":"x"}]}', new Error('down'));
    await expect(check(client).settle(BODY, input)).resolves.toEqual({ detail: 'letter_claims:unavailable' });
  });

  it('refuses a letter left with less than two sentences', async () => {
    const client = replies('{"issues":[{"n":2,"kind":"actor","why":"x"}]}', '{"fixes":[{"n":2,"text":""}]}');
    await expect(check(client).settle('Я вырос. Я вырастил команду.', input)).resolves.toEqual({ detail: 'letter_claims:too_short' });
  });
});

describe('QueuedCoverLetterWriter with the claim check', () => {
  const stage = (body: string, name: string) => ({ writeCoverLetter: async () => ({ body, stage: name }) });

  it('gives the candidate the repaired letter and asks no further stage', async () => {
    const queue = new QueuedCoverLetterWriter([stage('Я вырастил команду. Я руковожу.', 'a')], [], () => {}, {
      settle: async () => ({ body: 'Команда выросла. Я руковожу.', flagged: 1 }),
    });
    await expect(queue.writeCoverLetter(input)).resolves.toEqual({ body: 'Команда выросла. Я руковожу.', stage: 'a' });
  });

  it('moves to the next stage when the check refuses', async () => {
    const failures: unknown[] = [];
    const queue = new QueuedCoverLetterWriter([stage('Плохо.', 'a'), stage('Хорошо.', 'b')], [], (failure) => failures.push(failure), {
      settle: async (body) => (body === 'Плохо.' ? { detail: 'letter_claims:actor' } : { body, flagged: 0 }),
    });
    await expect(queue.writeCoverLetter(input)).resolves.toMatchObject({ body: 'Хорошо.', stage: 'b' });
    expect(failures).toEqual([{ stage: 'a', kind: 'unusable_response', detail: 'letter_claims:actor' }]);
  });
});
