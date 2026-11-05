import { describe, expect, it } from 'vitest';
import { HygienicCoachProvider } from './hygienicCoachProvider';
import type { CoachProvider, CoachProviderResult } from './coachProvider';
import type { CoachTurnInput } from '../domain/coach';

const ZWSP = '​';
const TAG_A = '\u{E0061}';

function providerReturning(result: unknown): CoachProvider {
  return {
    createTurn: async () => result as CoachProviderResult,
  } as CoachProvider;
}

const input = { dataClass: 'personal' } as unknown as CoachTurnInput;

describe('ответ модели доходит до кандидата без невидимых меток (B210)', () => {
  it('чистит текст на любой глубине ответа', async () => {
    const provider = new HygienicCoachProvider({
      inner: providerReturning({
        result: {
          message: `Ваш${ZWSP} опыт${TAG_A}`,
          steps: [{ title: `Шаг${ZWSP} первый` }],
        },
        provider: 'openai',
        model: 'gpt',
        responseId: 'r1',
        usage: {},
      }),
    });

    const answer = await provider.createTurn(input, 'key-1');

    expect(answer.result).toEqual({
      message: 'Ваш опыт',
      steps: [{ title: 'Шаг первый' }],
    });
    expect(answer.model).toBe('gpt');
  });

  it('не пересобирает ответ, в котором чистить нечего', async () => {
    const clean = {
      result: { message: 'Чистый ответ' },
      provider: 'openai',
      model: 'gpt',
      responseId: 'r2',
      usage: {},
    };
    const provider = new HygienicCoachProvider({ inner: providerReturning(clean) });

    const answer = await provider.createTurn(input, 'key-2');

    expect(answer).toBe(clean);
  });
});

describe('потоковый текст ответа тоже без невидимых меток (29.10)', () => {
  it('чистит каждый промежуточный текст и пропускает сброс', async () => {
    const inner: CoachProvider = {
      async createTurn(_input, _key, options) {
        options?.onMessageText?.(`Ваш${ZWSP}`);
        options?.onMessageText?.('');
        return { result: { message: 'Ваш' } } as unknown as CoachProviderResult;
      },
    };
    const seen: string[] = [];

    await new HygienicCoachProvider({ inner }).createTurn(input, 'key-s', {
      onMessageText: (text) => seen.push(text),
    });

    expect(seen).toEqual(['Ваш', '']);
  });
});

describe('метки контекста в ответе консультанта (B511 Д6)', () => {
  const answer = (message: string, nextQuestion: string | null = null) =>
    providerReturning({
      result: { message, nextQuestion, memoryCandidates: [{ sourceMessageIds: ['memory:abc'] }] },
      provider: 'openai',
      model: 'gpt',
      responseId: 'r1',
      usage: {},
    });

  it('чистит message и nextQuestion, а ссылки в служебных полях не трогает', async () => {
    const provider = new HygienicCoachProvider({ inner: answer('Это НЕИЗВЕСТНО (memory:abc).', 'Что в stageContext?') });
    const { result } = await provider.createTurn(input, 'key');
    expect(result.message).toBe('Это неизвестно.');
    expect(result.nextQuestion).not.toContain('stageContext');
    expect(result.memoryCandidates[0]?.sourceMessageIds).toEqual(['memory:abc']);
  });

  it('потоковый текст чистится так же', async () => {
    const seen: string[] = [];
    const inner = {
      createTurn: async (_input: unknown, _key: unknown, options?: { onMessageText?: (text: string) => void }) => {
        options?.onMessageText?.('Пока НЕИЗВЕСТНО');
        return { result: { message: 'Пока НЕИЗВЕСТНО', nextQuestion: null }, provider: 'openai', model: 'gpt', responseId: 'r', usage: {} };
      },
    } as unknown as CoachProvider;
    await new HygienicCoachProvider({ inner }).createTurn(input, 'key', { onMessageText: (text) => seen.push(text) });
    expect(seen).toEqual(['Пока неизвестно']);
  });

  it('шаг сервера с JSON в message не трогается', async () => {
    const provider = new HygienicCoachProvider({ inner: answer('{"status":"НЕИЗВЕСТНО","ref":"memory:abc"}') });
    const stageInput = { dataClass: 'personal', internalPurpose: 'structured-stage' } as unknown as CoachTurnInput;
    const { result } = await provider.createTurn(stageInput, 'key');
    expect(result.message).toBe('{"status":"НЕИЗВЕСТНО","ref":"memory:abc"}');
  });

  it.each([
    ['просьба в тексте (E3)', 'Расскажите суть: что за офис и чем закончилось.', 'Что это был за офис?', null],
    ['вопрос в тексте (F5)', 'Состоялась ли сделка? Без этого фразы не будет.', 'Была ли сделка?', null],
    ['просьба после двоеточия (F10)', 'Чтобы понять, откуда «треть», вспомните: где это было.', 'Где это было?', null],
    ['текст ничего не спрашивает', 'Поставьте результат в начало письма.', 'За какой срок вырос сервис?', 'За какой срок вырос сервис?'],
  ])('следующий вопрос не повторяет текст: %s', async (_label, message, nextQuestion, expected) => {
    const provider = new HygienicCoachProvider({
      inner: providerReturning({ result: { message, nextQuestion }, usage: {} }),
    });
    const { result } = await provider.createTurn(input, 'key');
    expect(result.nextQuestion).toBe(expected);
  });
});
