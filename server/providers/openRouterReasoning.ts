/**
 * Поле `reasoning` запроса к OpenRouter. Рассуждение выключено везде, кроме моделей, где оно
 * обязательно: glm-5.3-flash на `enabled: false` отвечает 400 «Reasoning is mandatory…»
 * (04.11: 1 933 вызова ступени, ни одного ответа). Замер 04.11 на 40 названиях: `effort: 'low'`
 * — 18 токенов рассуждения, 13 с, $0,0004; без поля — 2 214 токенов и тайм-аут.
 */
const MANDATORY_REASONING_MODELS: ReadonlySet<string> = new Set(['z-ai/glm-5.3-flash']);

export function openRouterReasoning(
  model: string,
): { readonly enabled: false } | { readonly effort: 'low' } {
  return MANDATORY_REASONING_MODELS.has(model) ? { effort: 'low' } : { enabled: false };
}
