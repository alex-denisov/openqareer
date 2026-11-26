import { createHash } from 'node:crypto';
import type { AppSignInDelivery } from './authTypes';
import { escapeHtml } from './passkeyAddedEmail';

interface AppSignInNotifierOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly publicBaseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

const WHEN = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * B755: письмо владельцу о входе в приложение через системный лист — сразу, с устройством и
 * временем. Решение оркестратора (вариант «без кода сверки»): о каждом таком входе владелец
 * узнаёт по почте и может завершить сессию в «Вход и безопасность».
 */
export function buildAppSignInNotifier({
  apiKey,
  from,
  publicBaseUrl,
  fetchImpl = fetch,
}: AppSignInNotifierOptions): (input: AppSignInDelivery) => Promise<void> {
  return async (input) => {
    const securityUrl = new URL('/app/account/security', publicBaseUrl).toString();
    const greeting = input.displayName
      ? `Здравствуйте, ${escapeHtml(input.displayName)}!`
      : 'Здравствуйте!';
    const when = `${WHEN.format(input.at)} по Москве`;
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'openqareer/1.0',
        'Idempotency-Key': `app-sign-in/${createHash('sha256')
          .update(`${input.email}/${input.at.toISOString()}`)
          .digest('hex')
          .slice(0, 40)}`,
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: 'Вход в приложение openqareer',
        html: appSignInHtml(greeting, input.deviceLabel, when, securityUrl),
      }),
    });
    if (!response.ok) {
      throw new Error(`app sign-in email rejected with status ${response.status}`);
    }
  };
}

function appSignInHtml(
  greeting: string,
  deviceLabel: string,
  when: string,
  securityUrl: string,
): string {
  return `<!doctype html>
<html lang="ru">
  <body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17211f">
    <main style="max-width:560px;margin:0 auto;padding:32px 24px">
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5">${greeting}</p>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5">Выполнен вход в ваш аккаунт openqareer: «${escapeHtml(deviceLabel)}», ${escapeHtml(when)}.</p>
      <a href="${escapeHtml(securityUrl)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#2f6f62;color:#ffffff;text-decoration:none;font-weight:700">Вход и безопасность</a>
      <p style="margin:24px 0 0;color:#60736e;font-size:13px;line-height:1.5">Если это были не вы, завершите эту сессию в «Вход и безопасность» и смените пароль.</p>
    </main>
  </body>
</html>`;
}
