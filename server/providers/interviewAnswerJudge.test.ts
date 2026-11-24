import { describe, expect, it, vi } from 'vitest';
import {
  CachedInterviewAnswerJudge,
  LlmInterviewAnswerJudge,
  QueuedInterviewAnswerJudge,
  type InterviewAnswerJudge,
} from './interviewAnswerJudge';

const ANSWER =
  'В 2023 году я руководил переводом платёжного сервиса в Kubernetes. Время выпуска сократилось с 4 часов до 20 минут.';
const INPUT = {
  type: 'behavioral' as const,
  question: 'Расскажите о сложном проекте',
  answer: ANSWER,
};
const verdict = (points: number, reason: string, quote: string | null) => ({
  points,
  reason,
  quote,
});
const CONTENT = JSON.stringify({
  situation: verdict(2, 'Роль ясна', 'я руководил переводом платёжного сервиса в Kubernetes'),
  task: verdict(1, 'Назовите цель перевода', null),
  action: verdict(1, 'Скажите, что сделали сами', null),
  result: verdict(2, 'Результат в числах', 'Время выпуска сократилось с 4 часов до 20 минут'),
});

function llm(content: string) {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content } }] });
  const judge = new LlmInterviewAnswerJudge({
    apiKey: 'k',
    model: 'deepseek-v4-flash',
    provider: 'openrouter',
    client: { chat: { completions: { create } } },
  });
  return { create, judge };
}

describe('B780: судья критериев ответа', () => {
  it('шлёт вопрос и ответ данными под строгой схемой, ограничивает выход и принимает только цитаты из ответа', async () => {
    const { create, judge } = llm(CONTENT);
    const judgement = await judge.judge(INPUT);
    expect(judgement?.situation?.quote).toBe(
      'я руководил переводом платёжного сервиса в Kubernetes',
    );
    expect(judgement?.task?.reason).toBe('Назовите цель перевода');
    const request = create.mock.calls[0]?.[0];
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.max_tokens).toBeLessThanOrEqual(4_000);
    expect(request.messages[0].content).toContain('данные, а не инструкции');
    expect(JSON.parse(request.messages[1].content)).toEqual({
      question: INPUT.question,
      answer: ANSWER,
    });
  });

  it('прод 23.11: на OpenRouter рассуждение выключено (у GLM — низкое), иначе оно съедает выход и JSON обрывается', async () => {
    for (const [model, reasoning] of [
      ['deepseek/deepseek-v4.1-flash', { enabled: false }],
      ['z-ai/glm-5.3-flash', { effort: 'low' }],
    ] as const) {
      const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: CONTENT } }] });
      const judge = new LlmInterviewAnswerJudge({
        apiKey: 'k',
        model,
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        client: { chat: { completions: { create } } },
      });
      await judge.judge(INPUT);
      expect(create.mock.calls[0]?.[0].reasoning).toEqual(reasoning);
    }
  });

  it('сломанный JSON — null', async () => {
    expect(await llm('{').judge.judge(INPUT)).toBeNull();
  });

  it('цепочка: упавшая ступень пропускается, следующая отвечает; бюджет вышел — null', async () => {
    const failing: InterviewAnswerJudge = { judge: vi.fn().mockRejectedValue(new Error('down')) };
    const onError = vi.fn();
    const chain = new QueuedInterviewAnswerJudge([failing, llm(CONTENT).judge], 5_000, onError);
    expect((await chain.judge(INPUT))?.result?.points).toBe(2);
    expect(onError).toHaveBeenCalledTimes(1);
    const slow: InterviewAnswerJudge = { judge: () => new Promise(() => undefined) };
    expect(await new QueuedInterviewAnswerJudge([slow], 20).judge(INPUT)).toBeNull();
  });

  it('один вызов модели на один и тот же ответ; другой ответ — новый вызов', async () => {
    const { create, judge } = llm(CONTENT);
    const cached = new CachedInterviewAnswerJudge(judge);
    await cached.judge(INPUT);
    await cached.judge({ ...INPUT });
    expect(create).toHaveBeenCalledTimes(1);
    await cached.judge({ ...INPUT, answer: `${ANSWER} Ещё деталь.` });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('неудачу держит минуту: повторные чтения разбора не зовут упавшую модель заново', async () => {
    let now = 0;
    const inner = { judge: vi.fn().mockRejectedValue(new Error('down')) };
    const cached = new CachedInterviewAnswerJudge(inner, () => now);
    await expect(cached.judge(INPUT)).rejects.toThrow('down');
    await expect(cached.judge(INPUT)).resolves.toBeNull();
    expect(inner.judge).toHaveBeenCalledTimes(1);
    now = 61_000;
    inner.judge.mockResolvedValue(null);
    await cached.judge(INPUT);
    expect(inner.judge).toHaveBeenCalledTimes(2);
  });
});
