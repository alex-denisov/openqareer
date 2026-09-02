import { describe, expect, it } from 'vitest';
import {
  cloudflareGatewayHeaders,
  geminiGatewayBaseUrl,
  readCloudflareGatewayConfig,
} from './cloudflareAiGateway';

/**
 * Владелец: Gemini используется **только** через тоннель Cloudflare
 * (решение 2026-09-02, как в eterapy). Прямой вызов из прода до
 * `gemini-3.7-flash` не доходит вовсе — 60 секунд без ответа, тогда как 3.5,
 * 3.6 и 3.8 отвечают за секунды.
 */
describe('Cloudflare AI Gateway', () => {
  it('читает настройки тоннеля из окружения', () => {
    expect(
      readCloudflareGatewayConfig({
        OPENQAREER_CF_AI_GATEWAY_ACCOUNT_ID: 'a'.repeat(32),
        OPENQAREER_CF_AI_GATEWAY_ID: 'openqareer',
        OPENQAREER_CF_AI_GATEWAY_TOKEN: 'secret-token',
      }),
    ).toEqual({
      accountId: 'a'.repeat(32),
      gatewayId: 'openqareer',
      token: 'secret-token',
    });
  });

  it('без обоих идентификаторов тоннеля нет — и Gemini остаётся ненастроенным', () => {
    expect(readCloudflareGatewayConfig({ OPENQAREER_CF_AI_GATEWAY_ID: 'openqareer' })).toBeUndefined();
    expect(readCloudflareGatewayConfig({})).toBeUndefined();
  });

  it('строит адрес Google AI Studio через шлюз', () => {
    expect(
      geminiGatewayBaseUrl({ accountId: 'acc', gatewayId: 'gw' }),
    ).toBe('https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio/v1beta');
  });

  it('прикладывает авторизацию шлюза только когда токен задан', () => {
    expect(cloudflareGatewayHeaders({ accountId: 'a', gatewayId: 'g', token: 't' })).toEqual({
      'cf-aig-authorization': 'Bearer t',
    });
    expect(cloudflareGatewayHeaders({ accountId: 'a', gatewayId: 'g' })).toEqual({});
  });
});
