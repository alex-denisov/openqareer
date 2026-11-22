import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';

const base64url = z
  .string()
  .max(20_000)
  .regex(/^[A-Za-z0-9_-]*$/u);
const credentialId = z
  .string()
  .min(1)
  .max(1_400)
  .regex(/^[A-Za-z0-9_-]+$/u);
const common = {
  id: credentialId,
  rawId: credentialId,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
};
const token = z.string().min(1).max(200);

const registration = z.object({
  token,
  response: z.object({
    ...common,
    response: z.object({
      clientDataJSON: base64url,
      attestationObject: base64url,
      authenticatorData: base64url.optional(),
      publicKey: base64url.optional(),
      publicKeyAlgorithm: z.number().int().optional(),
      transports: z.array(z.string().max(32)).max(8).optional(),
    }),
  }),
});

const authentication = z.object({
  token,
  response: z.object({
    ...common,
    response: z.object({
      clientDataJSON: base64url,
      authenticatorData: base64url,
      signature: base64url,
      userHandle: base64url.optional(),
    }),
  }),
});

interface Parsed<T> {
  readonly token: string;
  readonly response: T;
}

/** Ответ браузера на создание ключа: токен вызова и JSON, как его отдаёт `startRegistration`. */
export function parseRegistrationBody(body: unknown): Parsed<RegistrationResponseJSON> | null {
  const parsed = registration.safeParse(body);
  return parsed.success ? (parsed.data as unknown as Parsed<RegistrationResponseJSON>) : null;
}

/** Ответ браузера на вход ключом: токен вызова и JSON, как его отдаёт `startAuthentication`. */
export function parseAuthenticationBody(body: unknown): Parsed<AuthenticationResponseJSON> | null {
  const parsed = authentication.safeParse(body);
  return parsed.success ? (parsed.data as unknown as Parsed<AuthenticationResponseJSON>) : null;
}
