import type { CoachProvider } from './coachProvider';
import { NativeCoachProvider } from './nativeCoachProvider';
import { VertexTokenProvider, vertexPublisherBaseUrl, type VertexConfig } from './vertexAi';

/**
 * Ступень консультанта на Gemini Vertex (решение владельца 04.11). Тот же запрос, схема ответа
 * и проверки, что у `NativeCoachProvider` для Gemini; отличается адрес издателя и токен сервисного
 * аккаунта. `fetchImpl` — учётный `fetch` механики (`meteredVertexFetchFor`): ворота, журнал и
 * потолок ступени живут в нём, мимо него вызова нет. Рассуждение `low` с запасом токенов
 * (`geminiOutputBudget`), `temperature` не задаётся — как у остальных ступеней консультанта.
 * Стриминга у ступени нет: текст приходит целиком, поэтому упавшей посреди потока Vertex-ступени не бывает.
 */
export function buildVertexCoachStage(options: {
  readonly vertex: VertexConfig;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs?: number;
}): CoachProvider {
  const { vertex, fetchImpl, timeoutMs } = options;
  const tokens = new VertexTokenProvider(vertex, fetchImpl);
  return new NativeCoachProvider({
    provider: 'gemini',
    apiKey: '',
    baseUrl: vertexPublisherBaseUrl(vertex),
    model: vertex.model,
    thinkingLevel: 'low',
    authHeaders: async () => ({ Authorization: `Bearer ${await tokens.token()}` }),
    fetchImpl,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}
