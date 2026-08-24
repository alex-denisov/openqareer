import { createHash } from 'node:crypto';
import type { PasswordResetDelivery } from './authService';

interface PasswordResetNotifierOptions {
  apiKey: string;
  from: string;
  publicBaseUrl: string;
  fetchImpl?: typeof fetch;
}

export function buildPasswordResetNotifier({
  apiKey,
  from,
  publicBaseUrl,
  fetchImpl = fetch,
}: PasswordResetNotifierOptions): (
  input: PasswordResetDelivery,
) => Promise<void> {
  return async (input) => {
    const resetUrl = new URL('/reset-password', publicBaseUrl);
    resetUrl.searchParams.set('token', input.token);
    const greeting = input.displayName
      ? `Здравствуйте, ${escapeHtml(input.displayName)}!`
      : 'Здравствуйте!';
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'openqareer/1.0',
        'Idempotency-Key': `password-reset/${createHash('sha256')
          .update(input.token)
          .digest('hex')
          .slice(0, 40)}`,
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: 'Сброс пароля — openqareer',
        html: passwordResetHtml(greeting, resetUrl.toString()),
      }),
    });
    if (!response.ok) {
      throw new Error(
        `password reset email rejected with status ${response.status}`,
      );
    }
  };
}

function passwordResetHtml(greeting: string, resetUrl: string): string {
  return `<!doctype html>
<html lang="ru">
  <body style="margin:0;background:#f4f7f6;color:#17352f;font-family:Arial,sans-serif">
    <main style="max-width:560px;margin:32px auto;padding:32px;background:#ffffff;border:1px solid #d8e5e1;border-radius:20px">
      <p style="margin:0 0 16px;color:#2f6f62;font-weight:700">openqareer</p>
      <h1 style="margin:0 0 16px;font-size:26px">Сброс пароля</h1>
      <p style="margin:0 0 12px;line-height:1.6">${greeting}</p>
      <p style="margin:0 0 24px;line-height:1.6">Мы получили запрос на сброс пароля. Ссылка действует один час и сработает только один раз.</p>
      <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#2f6f62;color:#ffffff;text-decoration:none;font-weight:700">Задать новый пароль</a>
      <p style="margin:24px 0 0;color:#60736e;font-size:13px;line-height:1.5">Если вы не запрашивали сброс, ничего делать не нужно.</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return character;
    }
  });
}
