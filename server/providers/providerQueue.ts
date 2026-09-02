import {
  allowedModels,
  PROVIDER_IDS,
  type ProviderId,
} from './modelRegistry';

/** Одна ступень очереди: провайдер и его модель. */
export interface ProviderQueueEntry {
  provider: ProviderId;
  model?: string;
}

export interface ProviderRoute {
  provider: ProviderId;
  apiKey: string;
  model: string;
}

/**
 * Очередь моделей по приоритету — одна и та же механика для персонального и
 * обезличенного класса данных (решение владельца 2026-09-02).
 *
 * Ступени называются поимённо, потому что порядок реестра для этого не годится:
 * после Gemini он поставил бы OpenAI, а владелец назвал `nvidia/nemotron`.
 * Одного провайдера можно назвать дважды с разными моделями — очередь состоит
 * из **моделей**, а не из провайдеров: `nvidia/nemotron-…` и `openrouter/free`
 * оба живут за `openrouter`, и это две разные ступени.
 *
 * Остальные настроенные провайдеры идут следом одной моделью каждый: очередь,
 * дошедшая до конца названного списка, лучше очереди, которая кончилась.
 */
export function selectProviderQueue(input: {
  head: ProviderQueueEntry;
  fallbacks?: readonly ProviderQueueEntry[];
  credentials: Partial<Record<ProviderId, string>>;
}): ProviderRoute[] {
  const named = [input.head, ...(input.fallbacks ?? [])];
  const remaining: ProviderQueueEntry[] = PROVIDER_IDS.filter(
    (provider) => !named.some((entry) => entry.provider === provider),
  ).map((provider) => ({ provider }));

  const seen = new Set<string>();
  return [...named, ...remaining].flatMap((entry) => {
    const apiKey = input.credentials[entry.provider];
    const eligible = allowedModels(entry.provider);
    const model = entry.model ?? eligible[0]?.id;
    if (!apiKey || !model || !eligible.some((candidate) => candidate.id === model)) {
      return [];
    }
    // Одна и та же модель дважды — это не запасной маршрут, а лишний вызов.
    const key = `${entry.provider}:${model}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ provider: entry.provider, apiKey, model }];
  });
}

/**
 * Отчёт о запасных ступенях считается той же функцией, что и маршрутизация.
 * Отчёт, расходящийся с поведением, хуже отсутствующего (B183).
 */
export function queueFallbackDescriptors(input: {
  head: ProviderQueueEntry;
  fallbacks?: readonly ProviderQueueEntry[];
  credentials: Partial<Record<ProviderId, string>>;
}): Array<{ provider: ProviderId; model: string }> {
  return selectProviderQueue(input)
    .slice(1)
    .map((route) => ({ provider: route.provider, model: route.model }));
}

/**
 * Сколько ступеней очереди имеет смысл пробовать.
 *
 * На проде очередь владельца из четырёх ступеней обрывалась на третьей: потолок
 * попыток стоял жёсткой тройкой, и последняя — единственная платная и надёжная —
 * не пробовалась вовсе (B183). Названное владельцем должно быть испробовано
 * целиком; про запас добавляется одна неназванная ступень, дальше отказ честнее
 * бесконечного перебора каталога.
 */
export function namedQueueDepth(input: {
  head: ProviderQueueEntry;
  fallbacks?: readonly ProviderQueueEntry[];
}): number {
  return 1 + (input.fallbacks?.length ?? 0) + 1;
}
