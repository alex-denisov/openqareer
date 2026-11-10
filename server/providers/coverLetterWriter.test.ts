import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { CANDIDATE_VERTEX_TIMEOUT_MS } from './meteredVertexFetch';
import { describe, expect, it, vi } from 'vitest';
import { COVER_LETTER_MAX_CHARS } from '../domain/coverLetterWriting';
import type { ChatCompletionClient } from './roleNamer';
import {
  buildCoverLetterWriter,
  buildEnabledCoverLetterWriter,
  COVER_LETTER_BUDGET_MS,
  COVER_LETTER_OUTPUT_TOKENS,
  COVER_LETTER_VERTEX_TIMEOUT_MS,
  LETTER_MODEL_ENABLED,
  letterPrompt,
  LlmCoverLetterWriter,
  QueuedCoverLetterWriter,
  vacancyText,
  withinTimeBudget,
  type CoverLetterOutcome,
  type CoverLetterWriteInput,
  type CoverLetterWriter,
} from './coverLetterWriter';
import { SlowStageBreaker } from './letterStageBreaker';

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
  return { chat: { completions: { create: vi.fn().mockRejectedValue(error) } } };
}

const input = {
  profile: 'EXPERIENCE\n## Директор | Россети Цифра\n- Выручка выросла с 230 млн до 2 млрд рублей',
  vacancy: { title: 'Senior Platform Engineer', company: 'CloudScale Inc', description: 'Строим платформу.' },
};

const LETTER = 'Здравствуйте. Откликаюсь на вакансию.\n\nРезюме приложено. Буду рад обсудить.';

const write = (reply: ChatCompletionClient) =>
  new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', stage: 'test:m', client: reply }).writeCoverLetter(input);

const sent = (fake: ChatCompletionClient) =>
  vi.mocked(fake.chat.completions.create).mock.calls[0]?.[0] as Record<string, unknown>;

const openRouterWriter = (model: string, fake: ChatCompletionClient) =>
  new LlmCoverLetterWriter({
    apiKey: 'k', model, provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', client: fake,
  });

describe('LlmCoverLetterWriter: приём ответа (B601)', () => {
  it('берёт письмо обычным текстом, как его просит запрос', async () => {
    await expect(write(client(`  ${LETTER}\n`))).resolves.toEqual({ body: LETTER, stage: 'test:m' });
  });

  it('пустой ответ — отказ ступени с причиной: так выглядел DeepSeek при потолке 6 000', async () => {
    await expect(write(client(''))).resolves.toMatchObject({
      failure: { stage: 'test:m', kind: 'unusable_response', detail: 'empty' },
    });
    await expect(write(client(null))).resolves.toMatchObject({ failure: { detail: 'empty' } });
  });

  it('письмо, оборванное лимитом, не обрезается: в конце сказано про резюме, очередь спрашивает дальше', async () => {
    await expect(write(client('Первое предложение. Второе оборвано на', 'length'))).resolves.toMatchObject({
      failure: { kind: 'unusable_response', detail: 'cut' },
    });
  });

  it('текст без точки в конце считается оборванным и при finish_reason stop', async () => {
    await expect(write(client('Первое предложение. Второе оборвано на'))).resolves.toMatchObject({
      failure: { detail: 'cut' },
    });
  });

  it('письмо длиной с принятые и длиннее старого предела 1 800 приходит целиком', async () => {
    const long = `${'Фраза письма про опыт. '.repeat(90).trim()}`;
    expect(long.length).toBeGreaterThan(1800);
    expect(long.length).toBeLessThanOrEqual(COVER_LETTER_MAX_CHARS);
    await expect(write(client(long))).resolves.toMatchObject({ body: long });
  });

  it('«С уважением,» в конце — не обрыв: подпись ставит система', async () => {
    await expect(write(client(`${LETTER}\n\nС уважением,`))).resolves.toMatchObject({ body: LETTER });
  });

  it('B624: строка с именем для подписи снимается с письма и приходит отдельно', async () => {
    await expect(write(client(`${LETTER}\n\nИмя для подписи: Алексей Денисов`))).resolves.toEqual({
      body: LETTER, stage: 'test:m', senderName: 'Алексей Денисов',
    });
  });

  it('B624: имя в запросе к модели, когда оно есть в профиле', () => {
    expect(letterPrompt({ ...input, candidateName: 'Alexey Denisov' })).toContain('(в профиле: Alexey Denisov)');
    expect(letterPrompt(input)).toContain('Верни только текст сообщения.');
  });

  it('ответ сверх предела — сбой модели, а не письмо', async () => {
    await expect(write(client(`${'а'.repeat(COVER_LETTER_MAX_CHARS)}.`))).resolves.toMatchObject({
      failure: { detail: 'too_long' },
    });
  });

  it('отклоняет заглушку', async () => {
    await expect(write(client('Здравствуйте, [Имя]. Резюме приложено.'))).resolves.toMatchObject({
      failure: { detail: 'placeholder' },
    });
  });

  it.each(['Импортировал резюме из hh.', 'Письмо из подбора вакансий.'])('отклоняет служебную механику: %s', async (body) => {
    await expect(write(client(body))).resolves.toMatchObject({ failure: { detail: 'service_text' } });
  });

  it.each(['Вёл импортозамещение ПО.', 'Отвечал за импорт оборудования и сопоставление накладных.'])(
    'слова профессии не отклоняет: %s',
    async (body) => {
      await expect(write(client(body))).resolves.toMatchObject({ body });
    },
  );

  it('таймаут — отказ ступени', async () => {
    const timeout = Object.assign(new Error('late'), { name: 'TimeoutError' });
    await expect(write(throwingClient(timeout))).resolves.toMatchObject({ failure: { kind: 'timeout' } });
  });

  it('срок на весь ответ: отмена по сигналу считается таймаутом', async () => {
    await expect(write(throwingClient(new APIUserAbortError()))).resolves.toMatchObject({ failure: { kind: 'timeout' } });
    await expect(write(throwingClient(new APIConnectionTimeoutError()))).resolves.toMatchObject({ failure: { kind: 'timeout' } });
  });

  it('ключ провайдера не попадает в отказ', async () => {
    const error = Object.assign(new Error('bad key secret-k'), { status: 401 });
    const writer = new LlmCoverLetterWriter({ apiKey: 'secret-k', model: 'm', client: throwingClient(error) });
    const outcome = await writer.writeCoverLetter(input);
    expect(outcome.failure).toMatchObject({ kind: 'http_error', status: 401 });
    expect(outcome.failure?.detail).not.toContain('secret-k');
  });

  it('не зовёт модель, когда профиль пуст', async () => {
    const fake = client(LETTER);
    const writer = new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', client: fake });
    await expect(writer.writeCoverLetter({ ...input, profile: '  ' })).resolves.toEqual({});
    expect(fake.chat.completions.create).not.toHaveBeenCalled();
  });
});

describe('LlmCoverLetterWriter: запрос к модели (B601)', () => {
  it('один текст от пользователя с вакансией и всем профилем, без JSON-схемы', async () => {
    const fake = client(LETTER);
    await openRouterWriter('deepseek/deepseek-v4.1-flash', fake).writeCoverLetter(input);
    const request = sent(fake);
    const messages = request.messages as { role: string; content: string }[];
    expect(messages.map((message) => message.role)).toEqual(['user']);
    expect(messages[0]?.content).toContain('Строим платформу.');
    expect(messages[0]?.content).toContain('Выручка выросла с 230 млн до 2 млрд рублей');
    expect(request).not.toHaveProperty('response_format');
  });

  it.each(['deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash'])(
    '%s: рассуждение low и потолок, при котором письма принял владелец',
    async (model) => {
      const fake = client(LETTER);
      await openRouterWriter(model, fake).writeCoverLetter(input);
      expect(sent(fake)).toMatchObject({
        reasoning: { effort: 'low' },
        max_tokens: COVER_LETTER_OUTPUT_TOKENS,
        provider: { data_collection: 'deny', sort: 'latency' },
      });
    },
  );

  it('потолок вывода больше того, при котором DeepSeek молчал', () => {
    expect(COVER_LETTER_OUTPUT_TOKENS).toBeGreaterThan(6000);
  });

  it('передаёт сигнал со сроком на весь ответ', async () => {
    const fake = client(LETTER);
    await openRouterWriter('z-ai/glm-5.3-flash', fake).writeCoverLetter(input);
    const options = vi.mocked(fake.chat.completions.create).mock.calls[0]?.[1];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('у OpenAI поле reasoning не отправляет и зовёт лимит современным именем', async () => {
    const fake = client(LETTER);
    await new LlmCoverLetterWriter({ apiKey: 'k', model: 'm', provider: 'openai', client: fake }).writeCoverLetter(input);
    expect(sent(fake)).not.toHaveProperty('reasoning');
    expect(sent(fake)).toMatchObject({ max_completion_tokens: COVER_LETTER_OUTPUT_TOKENS });
  });
});

describe('letterPrompt: вакансия и получатель', () => {
  it('несёт полный текст, обязанности и требования без усечения до 20 пунктов', () => {
    const requirements = Array.from({ length: 40 }, (_, index) => `Требование ${index}`);
    const text = vacancyText({ title: 'CTO', company: 'Acme', description: 'x'.repeat(9000), requirements, responsibilities: ['Вести'] });
    expect(text).toContain('x'.repeat(9000));
    expect(text).toContain('Требование 39');
    expect(text).toContain('- Вести');
  });

  it('разметку источника превращает в текст', () => {
    expect(vacancyText({ title: 'CTO', description: '<p>Строим&nbsp;платформу</p><ul><li>Вести</li></ul>' }))
      .toBe('CTO\n\nСтроим платформу\n Вести');
  });

  it('подставляет получателя и род; без них говорит прямо', () => {
    const known = letterPrompt({ ...input, vacancy: { ...input.vacancy, recipient: { name: 'Екатерина', role: 'рекрутёр' } }, gender: 'female' });
    expect(known).toContain('Получатель: Екатерина, рекрутёр. Род кандидата: женский.');
    expect(letterPrompt(input)).toContain('Получатель: неизвестен. Род кандидата: не указан, пиши так, чтобы род кандидата не был виден.');
  });

  it('язык, выбранный кандидатом, идёт в запрос', () => {
    expect(letterPrompt({ ...input, chosenLanguage: 'en' })).toContain('на английском языке');
  });
});

describe('QueuedCoverLetterWriter', () => {
  it('спрашивает следующую ступень, когда первая молчит', async () => {
    const first = new LlmCoverLetterWriter({ apiKey: 'k', model: 'first', client: client('') });
    const second = new LlmCoverLetterWriter({ apiKey: 'k', model: 'second', stage: 'openai:second', client: client(LETTER) });
    const queue = new QueuedCoverLetterWriter([first, second], [], () => undefined);
    await expect(queue.writeCoverLetter(input)).resolves.toMatchObject({ body: LETTER, stage: 'openai:second' });
  });

  it('возвращает отказ, если ни одна ступень не ответила', async () => {
    const first = new LlmCoverLetterWriter({ apiKey: 'k', model: 'first', stage: 'openai:first', client: client('') });
    const outcome = await new QueuedCoverLetterWriter([first], [], () => undefined).writeCoverLetter(input);
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ stage: 'openai:first' });
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

  it('каждая ступень спрашивается один раз: таймаут и отказ проверки ведут к следующей (B640)', async () => {
    const calls: string[] = [];
    const stage = (label: string, outcome: Awaited<ReturnType<CoverLetterWriter['writeCoverLetter']>>): CoverLetterWriter => ({
      writeCoverLetter: async () => {
        calls.push(label);
        return outcome;
      },
    });
    const queue = new QueuedCoverLetterWriter(
      [
        stage('d', { failure: { stage: 'd', kind: 'timeout' } }),
        stage('g', { failure: { stage: 'g', kind: 'unusable_response', detail: 'letter_gate:distorted' } }),
        stage('v', { body: 'Письмо Gemini.', stage: 'v' }),
      ],
      ['d', 'g', 'v'],
      () => undefined,
    );
    await expect(queue.writeCoverLetter(input)).resolves.toMatchObject({ stage: 'v' });
    expect(calls).toEqual(['d', 'g', 'v']);
  });
});

describe('QueuedCoverLetterWriter: пустых писем нет (B640, решение CPO 10.11)', () => {
  const recorded = (label: string, outcomes: Awaited<ReturnType<CoverLetterWriter['writeCoverLetter']>>[], seen: CoverLetterWriteInput[]): CoverLetterWriter => ({
    writeCoverLetter: async (request) => {
      seen.push(request);
      return outcomes.shift() ?? { failure: { stage: label, kind: 'timeout' } };
    },
  });
  const named = (body: string) => (body.includes('Resource-Logistics') ? ['name'] : []);

  it('GLM отклонена проверкой, Gemini нет: второй вызов GLM с причиной отказа', async () => {
    const seen: CoverLetterWriteInput[] = [];
    const queue = new QueuedCoverLetterWriter(
      [
        recorded('d', [{ failure: { stage: 'd', kind: 'timeout' } }], []),
        recorded('g', [{ body: 'At GK Resource-Logistics I led.', stage: 'g' }, { body: 'At GK Resurs-Logistika I led.', stage: 'g' }], seen),
      ],
      ['d', 'g'],
      () => undefined,
    );
    await expect(queue.writeCoverLetter({ ...input, review: named })).resolves.toMatchObject({
      body: 'At GK Resurs-Logistika I led.',
      stage: 'g',
    });
    expect(seen.map((request) => request.correction)).toEqual([
      undefined,
      expect.stringContaining('Не переводи и не меняй названия работодателей'),
    ]);
    expect(letterPrompt(seen[1]!)).toContain('Прошлый вариант письма отклонён.');
    expect(letterPrompt(seen[0]!)).not.toContain('Прошлый вариант письма отклонён.');
  });

  it('второй отказ — отказ всей цепочки (маршрут отвечает 503)', async () => {
    const bad = { body: 'At GK Resource-Logistics I led.', stage: 'g' };
    const queue = new QueuedCoverLetterWriter([recorded('g', [bad, bad], [])], ['g'], () => undefined);
    const outcome = await queue.writeCoverLetter({ ...input, review: named });
    expect(outcome.body).toBeUndefined();
    expect(outcome.failure).toMatchObject({ stage: 'g', detail: 'letter_gate:name' });
  });

  it('таймауты без отказа проверки второго вызова не дают', async () => {
    const seen: CoverLetterWriteInput[] = [];
    const queue = new QueuedCoverLetterWriter([recorded('g', [], seen)], ['g'], () => undefined);
    await expect(queue.writeCoverLetter(input)).resolves.toMatchObject({ failure: { kind: 'timeout' } });
    expect(seen).toHaveLength(1);
  });

  it('два таймаута DeepSeek — следующее письмо начинается с GLM', async () => {
    const calls: string[] = [];
    const stage = (label: string, outcome: Awaited<ReturnType<CoverLetterWriter['writeCoverLetter']>>): CoverLetterWriter => ({
      writeCoverLetter: async () => {
        calls.push(label);
        return outcome;
      },
    });
    const queue = new QueuedCoverLetterWriter(
      [stage('d', { failure: { stage: 'd', kind: 'timeout' } }), stage('g', { body: 'Письмо GLM.', stage: 'g' })],
      ['d', 'g'],
      () => undefined,
      new SlowStageBreaker('d', () => 0, () => undefined),
    );
    await queue.writeCoverLetter(input);
    await queue.writeCoverLetter(input);
    calls.length = 0;
    await expect(queue.writeCoverLetter(input)).resolves.toMatchObject({ stage: 'g' });
    expect(calls).toEqual(['g']);
  });
});

describe('цепочка письма (решение владельца, B601)', () => {
  it('DeepSeek один раз, затем GLM через OpenRouter (B640)', () => {
    const writer = buildCoverLetterWriter({ providerCredentials: { openrouter: 'o', gemini: 'g', openai: 'k' } }) as unknown as {
      descriptors: readonly string[];
    };
    expect(writer.descriptors).toEqual([
      'openrouter:deepseek/deepseek-v4.1-flash',
      'openrouter:z-ai/glm-5.3-flash',
    ]);
  });
});

describe('сроки письма (B601)', () => {
  it('общий срок вмещает все три ступени и самую медленную замеренную', () => {
    expect(COVER_LETTER_BUDGET_MS).toBeGreaterThanOrEqual(100_000);
  });
});

describe('withinTimeBudget (B266)', () => {
  it('gives up on a writer that has not answered within the budget', async () => {
    const never = new Promise<CoverLetterOutcome>(() => undefined);
    await expect(withinTimeBudget(never, 5)).resolves.toEqual({ failure: { stage: 'budget', kind: 'timeout' } });
  });

  it('passes a timely answer through untouched', async () => {
    const answer = Promise.resolve<CoverLetterOutcome>({ body: 'Письмо.', stage: 's' });
    await expect(withinTimeBudget(answer, 1000)).resolves.toEqual({ body: 'Письмо.', stage: 's' });
  });
});

describe('letter model switch', () => {
  const credentials = { providerCredentials: { openrouter: 'k' } };

  it('письмо пишет модель: владелец принял письма и включил её 06.11', () => {
    expect(LETTER_MODEL_ENABLED).toBe(true);
    expect(buildEnabledCoverLetterWriter(credentials)).toBeDefined();
  });

  it('откат одним флагом: выключенный флаг возвращает шаблон', () => {
    expect(buildEnabledCoverLetterWriter(credentials, false)).toBeUndefined();
  });

  it('прод даёт Gemini тот же потолок, что и ступени, а не короткий потолок кандидата', () => {
    const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    expect(source).toMatch(/'coverLetters',\s*COVER_LETTER_VERTEX_TIMEOUT_MS/u);
    expect(COVER_LETTER_VERTEX_TIMEOUT_MS).toBeGreaterThan(CANDIDATE_VERTEX_TIMEOUT_MS);
  });
});
