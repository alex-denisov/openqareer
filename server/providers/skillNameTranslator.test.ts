import { describe, expect, it, vi } from 'vitest';
import { ChatSkillNameTranslator, parseSkillNames } from './skillNameTranslator';

describe('parseSkillNames (B734)', () => {
  it('берёт только названия из запроса, с непустым переводом', () => {
    const names = parseSkillNames(
      { names: { 'Cross-functional leadership': 'Кросс-функциональное лидерство', SQL: 'SQL', Чужое: 'x', Agile: '' } },
      ['Cross-functional leadership', 'SQL', 'Agile'],
    );
    expect([...names.entries()]).toEqual([
      ['Cross-functional leadership', 'Кросс-функциональное лидерство'],
      ['SQL', 'SQL'],
    ]);
  });

  it('чужая форма ответа — пусто, проверка идёт с исходными названиями', () => {
    expect(parseSkillNames('мусор', ['SQL']).size).toBe(0);
    expect(parseSkillNames({ names: { SQL: 'x'.repeat(201) } }, ['SQL']).size).toBe(0);
  });
});

describe('ChatSkillNameTranslator (B734)', () => {
  it('один запрос с названиями; правило «устоявшиеся термины не переводить» в промпте', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ names: { 'Stakeholder management': 'Управление заинтересованными сторонами' } }) } }] }), { status: 200 }),
    );
    const translator = new ChatSkillNameTranslator(
      [{ provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', apiKey: 'k' }],
      fetchImpl as unknown as typeof fetch,
    );
    const names = await translator.translate(['Stakeholder management']);
    expect(names.get('Stakeholder management')).toBe('Управление заинтересованными сторонами');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.messages[0].content).toContain('Agile');
  });
});
