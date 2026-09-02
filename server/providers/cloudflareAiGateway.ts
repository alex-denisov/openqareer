/**
 * Тоннель Cloudflare AI Gateway.
 *
 * Решение владельца 2026-09-02: Gemini используется **только** через тоннель,
 * как в eterapy. Прямой вызов подтверждает, зачем: с прод-хоста во Франкфурте
 * `gemini-3.5-flash`, `3.6` и `3.8` отвечают за 1.7–6.8 секунды, а
 * `gemini-3.7-flash` не отвечает вовсе — 60 секунд молчания. Через шлюз запрос
 * уходит с адресов Cloudflare, а не с адреса виртуальной машины.
 *
 * Настройки живут в окружении, а не в записи провайдера: смена токена не
 * должна требовать правки кода или базы.
 */
export interface CloudflareGatewayConfig {
  readonly accountId: string;
  readonly gatewayId: string;
  readonly token?: string;
}

export function readCloudflareGatewayConfig(
  environment: Record<string, string | undefined>,
): CloudflareGatewayConfig | undefined {
  const accountId = environment.OPENQAREER_CF_AI_GATEWAY_ACCOUNT_ID?.trim();
  const gatewayId = environment.OPENQAREER_CF_AI_GATEWAY_ID?.trim();
  if (!accountId || !gatewayId) return undefined;
  const token = environment.OPENQAREER_CF_AI_GATEWAY_TOKEN?.trim();
  return { accountId, gatewayId, ...(token ? { token } : {}) };
}

/** Google AI Studio за шлюзом отвечает по тому же пути `v1beta`. */
export function geminiGatewayBaseUrl(config: {
  readonly accountId: string;
  readonly gatewayId: string;
}): string {
  return `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}/google-ai-studio/v1beta`;
}

/** Аутентифицированный шлюз требует свой заголовок; открытый — нет. */
export function cloudflareGatewayHeaders(
  config: CloudflareGatewayConfig,
): Record<string, string> {
  return config.token ? { 'cf-aig-authorization': `Bearer ${config.token}` } : {};
}
