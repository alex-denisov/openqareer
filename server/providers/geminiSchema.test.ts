import { describe, expect, it } from 'vitest';
import { COACH_TURN_JSON_SCHEMA } from '../domain/coach';
import { geminiResponseSchema } from './geminiSchema';

/**
 * B183. Живая проверка через шлюз 2026-09-02: `gemini-3.8-flash` отвечает
 * `400 INVALID_ARGUMENT` на наш контракт вывода и `200` на тот же контракт без
 * `minLength`/`maxLength`/`maxItems`. `additionalProperties` она принимает.
 * Именно из-за этого включённый маршрут Gemini ронял ход коуча на проде.
 */
describe('geminiResponseSchema (B183)', () => {
  const schema = geminiResponseSchema(COACH_TURN_JSON_SCHEMA);
  const serialized = JSON.stringify(schema);

  it('убирает ограничения длины и размера, которые Gemini отвергает', () => {
    expect(serialized).not.toContain('minLength');
    expect(serialized).not.toContain('maxLength');
    expect(serialized).not.toContain('maxItems');
  });

  it('сохраняет форму контракта: поля, обязательность и перечисления', () => {
    const shaped = schema as {
      type: string;
      required: string[];
      properties: Record<string, { type?: string; enum?: string[] }>;
    };
    expect(shaped.type).toBe('object');
    expect(shaped.properties.message.type).toBe('string');
    expect(shaped.properties.phase.enum?.length).toBeGreaterThan(0);
    expect(shaped.required).toEqual([
      ...(COACH_TURN_JSON_SCHEMA as unknown as { required: readonly string[] }).required,
    ]);
    expect(serialized).toContain('additionalProperties');
  });

  it('не трогает исходный контракт: он общий для всех провайдеров', () => {
    expect(JSON.stringify(COACH_TURN_JSON_SCHEMA)).toContain('maxItems');
  });
});
