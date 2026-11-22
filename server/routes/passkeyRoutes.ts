import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deviceLabelOf } from '../auth/deviceLabel';
import { passkeyRelyingParty } from '../auth/passkeyRelyingParty';
import { closePasskeyStoreFor, passkeyStoreFor } from './passkeyAccess';
import { parseRegistrationBody } from './passkeyJson';
import { passkeyProven } from './passkeyProof';
import { sendError } from './helpers';
import { account, answer, type AccountHandler } from './twoFactorRoutes';

const BASE = '/api/v1/account/passkeys';
const idSchema = z.string().uuid();
const ADD_FAILED = 'Не удалось добавить устройство. Попробуйте ещё раз.';

const getList: AccountHandler = (deps, principal, request) =>
  answer(request, { passkeys: passkeyStoreFor(deps).list(principal.userId) });

/** Параметры создания ключа: нужен пароль (и код при 2FA). Требуем отпечаток или лицо и ключ на устройстве. */
const postOptions: AccountHandler = async (deps, principal, request, reply) => {
  if (!(await passkeyProven(deps, principal, request, reply))) return reply;
  const party = passkeyRelyingParty(deps.config);
  const store = passkeyStoreFor(deps);
  const options = await generateRegistrationOptions({
    rpName: party.name,
    rpID: party.id,
    userName: principal.email ?? principal.username,
    userID: new TextEncoder().encode(principal.userId),
    attestationType: 'none',
    excludeCredentials: store
      .credentialIdsOf(principal.userId)
      .map((key) => ({ id: key.id, transports: [...key.transports] })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const token = store.createChallenge('register', principal.userId, options.challenge, new Date());
  return answer(request, { options, token });
};

const postRegister: AccountHandler = async (deps, principal, request, reply) => {
  const body = parseRegistrationBody(request.body);
  if (!body) return sendError(reply, request, 400, 'passkey_invalid', ADD_FAILED, false);
  const store = passkeyStoreFor(deps);
  const now = new Date();
  // Вызов привязан к пользователю, который запросил параметры; чужой или повторный не принимается.
  const challenge = store.takeChallenge(body.token, 'register', now);
  if (!challenge || challenge.userId !== principal.userId) {
    return sendError(
      reply,
      request,
      400,
      'passkey_challenge_expired',
      'Начните добавление заново.',
      false,
    );
  }
  const party = passkeyRelyingParty(deps.config);
  const verified = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: [...party.origins],
    expectedRPID: party.id,
    requireUserVerification: true,
  }).catch(() => null);
  // Ключ без проверки пользователя (UV) входа не даст никогда: не сохраняем.
  if (!verified?.verified || !verified.registrationInfo.userVerified) {
    return sendError(reply, request, 400, 'passkey_invalid', ADD_FAILED, false);
  }
  const { credential, credentialBackedUp } = verified.registrationInfo;
  const id = store.add(
    principal.userId,
    {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      signCount: credential.counter,
      transports: credential.transports ?? [],
      backedUp: credentialBackedUp,
      deviceLabel: deviceLabelOf(request.headers['user-agent'], request.headers.origin),
    },
    now,
  );
  if (!id)
    return sendError(reply, request, 409, 'passkey_exists', 'Это устройство уже добавлено.', false);
  return answer(request, { id });
};

const deleteOne: AccountHandler = async (deps, principal, request, reply) => {
  const id = idSchema.safeParse((request.params as { id?: string }).id);
  if (!id.success)
    return sendError(reply, request, 404, 'passkey_not_found', 'Ключ не найден.', false);
  if (!(await passkeyProven(deps, principal, request, reply))) return reply;
  if (!passkeyStoreFor(deps).remove(principal.userId, id.data)) {
    return sendError(reply, request, 404, 'passkey_not_found', 'Ключ не найден.', false);
  }
  return answer(request, { removed: true });
};

const limit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

/** B755: ключи доступа в «Вход и безопасность» — за флагом B640, как настройки двухфакторной защиты. */
export function registerPasskeyAccountRoutes(
  app: FastifyInstance,
  deps: Parameters<typeof account>[0],
): void {
  app.addHook('onClose', async () => closePasskeyStoreFor(deps));
  app.get(BASE, account(deps, getList));
  app.post(`${BASE}/options`, limit, account(deps, postOptions, true));
  app.post(BASE, limit, account(deps, postRegister, true));
  app.delete(`${BASE}/:id`, limit, account(deps, deleteOne, true));
}
