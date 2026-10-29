import { describe, expect, it, vi } from 'vitest';
import { ChatSkillQuizModel, QueuedSkillQuizModel, buildSkillQuizModel } from './skillQuizModel';

const QUIZ = {
  questions: Array.from({ length: 8 }, (_, index) => ({
    question: `Что выберете в ситуации ${index}?`,
    options: ['Первое', 'Второе', 'Третье', 'Четвёртое'],
    correctOptionIndex: index % 4,
    explanation: 'Так принято в практике.',
  })),
};

function chatResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const route = (model: string) =>
  ({ provider: 'openrouter', apiKey: 'sk-or-test-key-long-enough', model }) as const;

describe('skill quiz model', () => {
  it('sends only the skill and the level to the model', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => chatResponse(QUIZ));
    const model = new ChatSkillQuizModel(
      route('deepseek/deepseek-v4.1-flash'),
      fetchImpl as unknown as typeof fetch,
    );

    const questions = await model.generate({ skill: 'Excel', level: 'middle' });

    expect(questions).toHaveLength(8);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(JSON.parse(body.messages[1]!.content)).toEqual({ skill: 'Excel', level: 'middle' });
  });

  it('moves to the next stage when a stage answers with a broken quiz', async () => {
    const broken = new ChatSkillQuizModel(
      route('deepseek/deepseek-v4.1-flash-1017'),
      vi.fn(async () => chatResponse({ questions: QUIZ.questions.slice(0, 3) })),
    );
    const good = new ChatSkillQuizModel(
      route('deepseek/deepseek-v4.1-flash'),
      vi.fn(async () => chatResponse(QUIZ)),
    );

    const questions = await new QueuedSkillQuizModel([broken, good]).generate({
      skill: '1С: Бухгалтерия',
      level: 'junior',
    });

    expect(questions[0]?.id).toBe('q1');
  });

  it('is absent without provider keys', () => {
    expect(buildSkillQuizModel({ providerCredentials: {} })).toBeUndefined();
  });
});
