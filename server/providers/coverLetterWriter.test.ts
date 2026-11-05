import { COVER_LETTER_MAX_CHARS } from '../domain/coverLetterWriting';
import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionClient } from './roleNamer';
import {
  buildEnabledCoverLetterWriter,
  LETTER_MODEL_ENABLED,
  LlmCoverLetterWriter,
  QueuedCoverLetterWriter,
  serializeInput,
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
      client: client('Здравствуйте! Я подхожу на роль.'),
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
        'I led platform modernization. Delivery became predictable. Most recently as VP of Technology & IT Operations,',
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
        'I led platform modernization. Most recently as VP,',
        'length',
      ),
    });

    const outcome = await writer.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ kind: 'unusable_response' });
  });

  it('считает оборванным текст без точки в конце, даже если провайдер ответил stop', async () => {
    // Прод 25.09: бесплатный nemotron закрыл JSON посреди фразы с finish_reason stop.
    const cut = client(
      'I am writing about the CTO role. My career spans operations and technology. It aligns with the focus of the',
    );
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: cut });

    await expect(writer.writeCoverLetter(input)).resolves.toMatchObject({
      body: 'I am writing about the CTO role. My career spans operations and technology.',
    });
  });

  it('отдаёт очереди следующего провайдера одно оборванное предложение', async () => {
    const cut = client(
      'I am writing to express my interest in the role, my career aligns closely with the focus of the',
    );
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: cut });

    const outcome = await writer.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ kind: 'unusable_response' });
  });

  it('письмо длиннее предела обрезает по предложению, а не выбрасывает (прод 25.09)', async () => {
    const sentence = 'I led a 250-person technology organization and grew revenue four times. ';
    const long = sentence.repeat(30).trim();
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      client: client(long),
    });

    const outcome = await writer.writeCoverLetter(input);

    expect(outcome.body?.length).toBeLessThanOrEqual(COVER_LETTER_MAX_CHARS);
    expect(outcome.body).toMatch(/times\.$/u);
  });

  it('падает в шаблон, когда ответ пуст', async () => {
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: client('   ') });
    const outcome = await writer.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ kind: 'unusable_response' });
  });

  it('отклоняет ответ с заглушкой-плейсхолдером', async () => {
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      client: client('Здравствуйте, [Имя компании]!'),
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
        'Данные взяты из импорта резюме и подбора вакансий.',
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

  it('потолок ступени обрывает и чтение тела ответа: заголовки OpenRouter приходят сразу (05.11)', async () => {
    const hanging: ChatCompletionClient = {
      chat: { completions: { create: (_request, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')));
      }) } },
    };
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', stage: 'openrouter:m', timeoutMs: 20, client: hanging });
    await expect(writer.writeCoverLetter(input)).resolves.toEqual({ failure: { stage: 'openrouter:m', kind: 'timeout' } });
  });

  it('не зовёт модель, когда фактов нет', async () => {
    const stub = client('x');
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({ ...input, facts: [] });
    expect(stub.chat.completions.create).not.toHaveBeenCalled();
  });

  it('убирает строку обращения: его добавит система', async () => {
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      client: client('Здравствуйте!\n\nЯ подхожу на роль. Это видно по опыту.'),
    });
    await expect(writer.writeCoverLetter(input)).resolves.toMatchObject({
      body: 'Я подхожу на роль. Это видно по опыту.',
    });
  });

  it('не просит у модели JSON', async () => {
    const stub = client('Письмо.');
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', provider: 'openrouter', client: stub });
    await writer.writeCoverLetter(input);
    expect(vi.mocked(stub.chat.completions.create).mock.calls[0]?.[0]).not.toHaveProperty('response_format');
  });

  it('передаёт язык в инструкцию модели', async () => {
    const stub = client('Hello! I fit the role.');
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({ ...input, language: 'en' });
    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages[0].content).toContain('Язык письма: английский');
  });

  it('для OpenAI задаёт современный лимит завершения', async () => {
    const stub = client('Письмо.');
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'gpt-5.6-luna',
      provider: 'openai',
      client: stub,
    });

    await writer.writeCoverLetter(input);

    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(call.max_completion_tokens).toBe(6_000);
    expect(call).not.toHaveProperty('max_tokens');
  });

  it('у OpenRouter рассуждение и письмо делят общий бюджет ответа', async () => {
    const stub = client('Письмо.');
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      provider: 'openrouter',
      client: stub,
    });

    await writer.writeCoverLetter(input);

    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(call.max_tokens).toBe(6_000);
    expect(call).not.toHaveProperty('max_completion_tokens');
  });

  it('отправляет не больше 30 лучших фактов: на семи письма выходили обрывочными (05.11)', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ref: `memory:${i}`,
      statement: `Факт номер ${i}`,
    }));
    const stub = client('Письмо.');
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({ ...input, facts: many });
    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages[1].content.match(/- Факт номер/gu)).toHaveLength(30);
  });

  it('перед лимитом ставит опыт по роли выше сертификатов', async () => {
    const stub = client('Письмо.');
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
    const sent = call.messages[1].content;
    expect(sent.indexOf('Led product transformation')).toBeLessThan(sent.indexOf('ITIL 4 Foundation'));
    expect(sent.indexOf('VP Product & Operations')).toBeLessThan(sent.indexOf('ITIL 4 Foundation'));
  });

  it('передаёт модели evidenceRefs выбранной роли первыми', async () => {
    const stub = client('Письмо.');
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({
      ...input,
      vacancy: {
        title: 'Chief Technology Officer',
        rankingContext: {
          vacancy: { functions: ['it-ops'], levelRank: 4 },
          campaignRole: {
            functions: ['it-ops'],
            levelRank: 3,
            evidenceRefs: ['memory:evidence'],
          },
        },
      },
      facts: [
        { ref: 'memory:other', statement: 'Led Technology transformation', domain: 'outcome' },
        { ref: 'memory:evidence', statement: 'VP of Technology & Operations', domain: 'role-evidence' },
      ],
    });
    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const sent = call.messages[1].content;

    expect(sent.indexOf('VP of Technology & Operations')).toBeLessThan(sent.indexOf('Led Technology transformation'));
  });

  it('ставит подтверждённый факт раньше импортированного в промпте (C46)', async () => {
    const stub = client('Письмо.');
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({
      ...input,
      facts: [
        { ref: 'imp-skill', statement: 'Kafka pipeline design', domain: 'skill', status: 'proposed' },
        { ref: 'conf-skill', statement: 'Terraform infrastructure', domain: 'skill', status: 'confirmed' },
      ],
    });
    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const sent = call.messages[1].content;
    expect(sent.indexOf('Terraform infrastructure')).toBeLessThan(sent.indexOf('Kafka pipeline design'));
  });

  it('промпт несёт требования вакансии и факты (C46)', async () => {
    const stub = client('Письмо.');
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: stub });
    await writer.writeCoverLetter({
      ...input,
      vacancy: { ...input.vacancy, requirements: ['TypeScript', 'Kubernetes'] },
    });
    const call = (stub.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const sent = call.messages[1].content;
    expect(sent).toContain('Требования: TypeScript, Kubernetes');
    expect(sent).toContain('- Увеличил пропускную способность API в 4 раза');
  });
});

describe('QueuedCoverLetterWriter', () => {
  it('спрашивает следующую ступень, когда первая молчит', async () => {
    const first = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'first',
      client: client(null),
    });
    const second = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'second',
      stage: 'openai:second',
      client: client('Письмо от второй ступени.'),
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
      client: client(null),
    });
    const queue = new QueuedCoverLetterWriter([first]);
    const outcome = await queue.writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ stage: 'openai:first' });
  });
});

describe('Письмо на проде 04.11: ступени и проверка письма', () => {
  it('у OpenRouter просит короткое рассуждение: письмо с ним живее и связнее (05.11)', async () => {
    const fake = client('Здравствуйте! Я подхожу на роль.');
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'deepseek/deepseek-v4.1-flash',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      client: fake,
    });
    await writer.writeCoverLetter(input);
    expect(vi.mocked(fake.chat.completions.create).mock.calls[0]?.[0]).toMatchObject({
      reasoning: { effort: 'low' },
    });
  });

  it('у OpenAI поле reasoning не отправляет', async () => {
    const fake = client('Здравствуйте! Я подхожу на роль.');
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', provider: 'openai', client: fake });
    await writer.writeCoverLetter(input);
    expect(vi.mocked(fake.chat.completions.create).mock.calls[0]?.[0]).not.toHaveProperty('reasoning');
  });

  it('письмо, остановленное проверкой, отдаёт очередь следующей ступени', async () => {
    const failures: unknown[] = [];
    const queue = new QueuedCoverLetterWriter(
      [
        { writeCoverLetter: async () => ({ body: 'Плохое письмо.', stage: 'a' }) },
        { writeCoverLetter: async () => ({ body: 'Хорошее письмо.', stage: 'b' }) },
      ],
      [],
      (failure) => failures.push(failure),
    );
    const outcome = await queue.writeCoverLetter({
      ...input,
      review: (body) => (body.startsWith('Плохое') ? ['number'] : []),
    });
    expect(outcome).toMatchObject({ body: 'Хорошее письмо.', stage: 'b' });
    // Only rule names reach the journal: the letter is the candidate's text.
    expect(failures).toEqual([{ stage: 'a', kind: 'unusable_response', detail: 'letter_gate:number' }]);
  });

  it('пишет письмо, когда есть только места работы', async () => {
    const writer = new LlmCoverLetterWriter({
      apiKey: 'k',
      model: 'm',
      client: client('Здравствуйте! Я подхожу на роль.'),
    });
    const career = [{ title: 'Руководитель разработки', employer: 'Финтех Лаб', years: '2024–по сей день' }];
    await expect(writer.writeCoverLetter({ ...input, facts: [], career })).resolves.toMatchObject({
      body: 'Здравствуйте! Я подхожу на роль.',
    });
  });

  it('отдаёт модели места работы отдельным списком', () => {
    const career = [{ title: 'Руководитель разработки', employer: 'Финтех Лаб', years: '2024–по сей день' }];
    expect(serializeInput({ ...input, career })).toContain('- Руководитель разработки, Финтех Лаб, 2024–по сей день');
    expect(serializeInput(input)).not.toContain('Места работы:');
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

describe('B422: компания «Хочу» в письме', () => {
  it('передаёт модели отметку кандидата, только если она есть', () => {
    const base = { facts: [], language: 'ru', tone: 'technical' } as const;
    const marked = serializeInput({ ...base, vacancy: { title: 'QA Lead', company: 'Acme', targetCompany: true } });
    const plain = serializeInput({ ...base, vacancy: { title: 'QA Lead', company: 'Acme' } });
    expect(marked).toContain('хочет работать именно в этой компании');
    expect(plain).not.toContain('хочет работать именно в этой компании');
  });
});

describe('letter model switch (D-F9)', () => {
  const credentials = { providerCredentials: { openrouter: { apiKey: 'test-key' } } } as never;

  it('prod asks no model for a letter while the switch is off', () => {
    expect(LETTER_MODEL_ENABLED).toBe(false);
    expect(buildEnabledCoverLetterWriter(credentials)).toBeUndefined();
  });

  it('the same wiring brings the chain back when step 2 turns it on', () => {
    expect(buildEnabledCoverLetterWriter(credentials, true)).toBeDefined();
  });
});

describe('serializeInput: what the model reads for a letter (05.11)', () => {
  const input = {
    facts: [
      { ref: 'a', statement: 'Команда выросла с 8 до 35', workplace: 'Ритейл Системс' },
      { ref: 'b', statement: 'Единая система KPI' },
    ],
    vacancy: { title: 'VP', description: `<p>Run   operating reviews.</p>${'x'.repeat(5_000)}` },
    language: 'ru' as const,
    tone: 'executive' as const,
  };

  it('gives the vacancy text, clean and bounded', () => {
    const text = serializeInput(input);
    expect(text).toContain('Run operating reviews.');
    expect(text.match(/x/gu)).toHaveLength(3_600 - 'Run operating reviews. '.length);
  });

  it('puts a fact under its workplace and the rest under «компания не указана»', () => {
    const career = [{ title: 'Директор', employer: 'Ритейл Системс', years: '2014–2021' }];
    const text = serializeInput({ ...input, career });
    expect(text).toContain('- Директор, Ритейл Системс, 2014–2021. Команда выросла с 8 до 35');
    const free = text.slice(text.indexOf('компания не указана'));
    expect(free).toContain('- Единая система KPI');
    expect(free).not.toContain('Команда выросла');
  });

  it('is plain text, not JSON', () => {
    expect(serializeInput(input).startsWith('ВАКАНСИЯ')).toBe(true);
  });
});
