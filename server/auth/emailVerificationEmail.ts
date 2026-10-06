import { createHash } from 'node:crypto';
import type { EmailVerificationDelivery } from './emailVerification';

interface EmailVerificationNotifierOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetchImpl?: typeof fetch;
}

export interface EmailVerificationSenderOptions {
  readonly apiKey?: string;
  readonly from?: string;
  readonly environment: string | undefined;
  readonly writeDevelopmentCode?: (line: string) => void;
}

export function buildEmailVerificationSender(
  options: EmailVerificationSenderOptions,
): ((input: EmailVerificationDelivery) => Promise<void>) | undefined {
  const { apiKey, from } = options;
  if (apiKey && from) return buildEmailVerificationNotifier({ apiKey, from });
  if (options.environment === 'production') return undefined;
  const write = options.writeDevelopmentCode ?? ((line) => process.stderr.write(line));
  return async ({ code }) => {
    write(JSON.stringify({ event: 'email_verification_dev_code', code }) + '\n');
  };
}

export function buildEmailVerificationNotifier({
  apiKey,
  from,
  fetchImpl = fetch,
}: EmailVerificationNotifierOptions): (input: EmailVerificationDelivery) => Promise<void> {
  return async (input) => {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'openqareer/1.0',
        'Idempotency-Key': emailVerificationIdempotencyKey(input),
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: 'Код подтверждения email — openqareer',
        text: emailVerificationEmailText(input.code),
      }),
    });
    if (!response.ok) {
      throw new Error(`email verification email rejected with status ${response.status}`);
    }
  };
}

export function emailVerificationEmailText(code: string): string {
  return `Ваш код подтверждения: ${code}. Он действует 15 минут. Если это были не вы — просто проигнорируйте письмо.`;
}

function emailVerificationIdempotencyKey(input: EmailVerificationDelivery): string {
  return `email-verification/${createHash('sha256')
    .update(`${input.candidateId}\u0000${input.code}`)
    .digest('hex')
    .slice(0, 40)}`;
}
