/**
 * Контракт вывода в том виде, в каком его принимает Gemini.
 *
 * Живая проверка через шлюз Cloudflare 2026-09-02: `gemini-3.8-flash` отвечает
 * `400 INVALID_ARGUMENT` на `COACH_TURN_JSON_SCHEMA` и `200` на тот же контракт
 * без `minLength`, `maxLength` и `maxItems`; `additionalProperties` она
 * принимает. Из-за этого включённый маршрут Gemini ронял ход коуча на проде.
 *
 * Снятие ограничений **не ослабляет проверку**: ответ всё равно разбирается
 * `coachTurnResultSchema`, и именно она решает, годится он или нет. Схема здесь
 * подсказывает модели форму, а не защищает нас от неё.
 */
const UNSUPPORTED_KEYWORDS = ['minLength', 'maxLength', 'maxItems'] as const;

export function geminiResponseSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => geminiResponseSchema(item));
  }
  if (schema && typeof schema === 'object') {
    return Object.fromEntries(
      Object.entries(schema)
        .filter(([key]) => !(UNSUPPORTED_KEYWORDS as readonly string[]).includes(key))
        .map(([key, value]) => [key, geminiResponseSchema(value)]),
    );
  }
  return schema;
}
