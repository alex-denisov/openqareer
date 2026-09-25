import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionClient } from './roleNamer';
import {
  LlmCoverLetterWriter,
  QueuedCoverLetterWriter,
  withinTimeBudget,
  type CoverLetterOutcome,
} from './coverLetterWriter';

function client(
  content: string | null,
  finishReason: 'stop' | 'length' = 'stop',
): ChatCompletionClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content }, finish_reason: finishReason }],
        }),
      },
    },
  };
}

function throwingClient(error: Error): ChatCompletionClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockRejectedValue(error),
      },
    },
  };
}

const input = {
  facts: [
    { ref: 'memory:1', statement: 'Увеличил пропускную способность API в 4 раза' },
    { ref: 'memory:2', statement: 'Владею TypeScript, Node.js' },
  ],
  vacancy: { title: 'Senior Platform Engineer', company: 'CloudScale Inc' },
  language: 'ru' as const,
  tone: 'executive' as const,
};

describe('LlmCoverLetterWriter', () => {
  it('использует ответ модели', async () => {
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      stage: 'openai:m',
      client: client(JSON.stringify({ body: 'Здравствуйте! Я подхожу на роль.' })),
    });

    await expect(writer.writeCoverLetter(input)).resolves.toMatchObject({
      body: 'Здравствуйте! Я подхожу на роль.',
      stage: 'openai:m',
    });
  });

  it('при обрыве модели убирает незаконченное предложение', async () => {
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      client: client(
        JSON.stringify({
          body: 'I led platform modernization. Delivery became predictable. Most recently as VP of Technology & IT Operations,',
        }),
        'length',
      ),
    });

    await expect(writer.writeCoverLetter(input)).resolves.toMatchObject({
      body: 'I led platform modernization. Delivery became predictable.',
    });
  });

  it('падает в шаблон, если после обрыва осталось меньше двух предложений', async () => {
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      client: client(
        JSON.stringify({ body: 'I led platform modernization. Most recently as VP,' }),
        'length',
      ),
    });

    const outcome = await writer.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ kind: 'unusable_response' });
  });

  it('падает в шаблон, когда ответ не JSON', async () => {
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: client('не json') });
    const outcome = await writer.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ kind: 'unusable_response' });
  });

  it('отклоняет ответ с заглушкой-плейсхолдером', async () => {
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      client: client(JSON.stringify({ body: 'Здравствуйте, [Имя компании]!' })),
    });
    const outcome = await writer.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ kind: 'unusable_response' });
  });

  it('отклоняет ответ, упоминающий импорт резюме', async () => {
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      client: client(
        JSON.stringify({ body: 'Данные взяты из импорта резюме и подбора вакансий.' }),
      ),
    });
    const outcome = await writer.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ kind: 'unusable_response' });
  });

  it('падает в шаблон и логирует отказ при таймауте', async () => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      stage: 'openai:m',
      client: throwingClient(error),
    });
    const outcome = await writer.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ stage: 'openai:m', kind: 'timeout' });
  });

  it('не зовёт модель, когда фактов нет', async () => {
    const stub = client(JSON.stringify({ body: 'x' }));
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({ ...input, facts: [] });
    expect(stub.chat.completions.create).not.toHaveBeenCalled();
  });

  it('передаёт язык в инструкцию модели', async () => {
    const stub = client(JSON.stringify({ body: 'Hello! I fit the role.' }));
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({ ...input, language: 'en' });
    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages[0].content).toContain('английском');
  });

  it('отправляет не больше 40 фактов', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ref: `memory:${i}`,
      statement: `Факт номер ${i}`,
    }));
    const stub = client(JSON.stringify({ body: 'Письмо.' }));
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({ ...input, facts: many });
    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const sent = JSON.parse(call.messages[1].content) as { facts: unknown[] };
    expect(sent.facts.length).toBe(40);
  });

  it('перед лимитом ставит опыт по роли выше сертификатов', async () => {
    const stub = client(JSON.stringify({ body: 'Письмо.' }));
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({
      ...input,
      vacancy: {
        title: 'Chief Product Technology Officer',
        description: 'Own product strategy and operations.',
      },
      facts: [
        { ref: 'imp-c-cert-1', statement: 'ITIL 4 Foundation', domain: 'other' },
        { ref: 'imp-c-cert-2', statement: 'Agile Fundamentals', domain: 'other' },
        { ref: 'imp-c-cert-3', statement: 'AWS Fundamentals', domain: 'other' },
        {
          ref: 'imp-c-exp-1',
          statement: 'VP Product & Operations — Commerce Platform',
          domain: 'role-evidence',
        },
        {
          ref: 'imp-c-ach-1-1',
          statement: 'Led product transformation across three business units',
          domain: 'outcome',
        },
        {
          ref: 'imp-c-exp-2',
          statement: 'VP of Engineering — Infrastructure Group',
          domain: 'role-evidence',
        },
      ],
    });
    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const sent = JSON.parse(call.messages[1].content) as { facts: Array<{ ref: string }> };
    expect(sent.facts.slice(0, 3).map((fact) => fact.ref)).toEqual([
      'imp-c-exp-1',
      'imp-c-ach-1-1',
      'imp-c-exp-2',
    ]);
  });
});

describe('QueuedCoverLetterWriter', () => {
  it('спрашивает следующую ступень, когда первая молчит', async () => {
    const first = new LlmCoverLetterWriter({ apiKey: 'k', model: 'first', client: client('не json') });
    const second = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'second',
      stage: 'openai:second',
      client: client(JSON.stringify({ body: 'Письмо от второй ступени.' })),
    });
    const queue = new QueuedCoverLetterWriter([first, second]);
    await expect(queue.writeCoverLetter(input)).resolves.toMatchObject({
      body: 'Письмо от второй ступени.',
      stage: 'openai:second',
    });
  });

  it('возвращает отказ, если ни одна ступень не ответила', async () => {
    const first = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'first',
      stage: 'openai:first',
      client: client('не json'),
    });
    const queue = new QueuedCoverLetterWriter([first]);
    const outcome = await queue.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ stage: 'openai:first' });
  });
});

describe('withinTimeBudget (B266)', () => {
  it('gives up on a writer that has not answered within the budget', async () => {
    const hanging = new Promise<CoverLetterOutcome>(() => {});
    const outcome = await withinTimeBudget(hanging, 20);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure?.kind).toBe('timeout');
  });

  it('passes a timely answer through untouched', async () => {
    const outcome = await withinTimeBudget(Promise.resolve({ body: 'Letter', stage: 's' }), 1_000);
    expect(outcome).toEqual({ body: 'Letter', stage: 's' });
  });
});
