import { createHash } from 'node:crypto';
import type { PasskeyAddedDelivery } from './authTypes';

interface PasskeyAddedNotifierOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly publicBaseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * B755: письмо владельцу о новом ключе входа. Ключ входит без второго фактора, поэтому о каждом
 * новом ключе владелец узнаёт по почте — даже если сессию, где его добавили, держит не он.
 */
export function buildPasskeyAddedNotifier({
  apiKey,
  from,
  publicBaseUrl,
  fetchImpl = fetch,
}: PasskeyAddedNotifierOptions): (input: PasskeyAddedDelivery) => Promise<void> {
  return async (input) => {
    const securityUrl = new URL('/app/account/security', publicBaseUrl).toString();
    const greeting = input.displayName
      ? `Здравствуйте, ${escapeHtml(input.displayName)}!`
      : 'Здравствуйте!';
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'openqareer/1.0',
        'Idempotency-Key': `passkey-added/${createHash('sha256')
          .update(input.passkeyId)
          .digest('hex')
          .slice(0, 40)}`,
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: 'Добавлен вход по Touch ID / Face ID — openqareer',
        html: passkeyAddedHtml(greeting, input.deviceLabel, securityUrl),
      }),
    });
    if (!response.ok) {
      throw new Error(`passkey added email rejected with status ${response.status}`);
    }
  };
}

function passkeyAddedHtml(
  greeting: string,
  deviceLabel: string | null,
  securityUrl: string,
): string {
  const device = deviceLabel ? ` на устройстве «${escapeHtml(deviceLabel)}»` : '';
  return `<!doctype html>
<html lang="ru">
  <body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17211f">
    <main style="max-width:560px;margin:0 auto;padding:32px 24px">
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5">${greeting}</p>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5">В ваш аккаунт openqareer добавлен вход по Touch ID / Face ID${device}.</p>
      <a href="${escapeHtml(securityUrl)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#2f6f62;color:#ffffff;text-decoration:none;font-weight:700">Вход и безопасность</a>
      <p style="margin:24px 0 0;color:#60736e;font-size:13px;line-height:1.5">Если это были не вы, смените пароль: при сбросе пароля все ключи входа удаляются.</p>
    </main>
  </body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) =>
    character === '&'
      ? '&amp;'
      : character === '<'
        ? '&lt;'
        : character === '>'
          ? '&gt;'
          : '&quot;',
  );
}
