import { cabinetB640Enabled } from '../auth/cabinetB640Access';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { passkeyRelyingParty } from '../auth/passkeyRelyingParty';
import type { StoredPasskey } from '../auth/passkeyStore';
import type { RouteDeps } from './deps';
import { csrfError, hasAllowedOrigin, publicPrincipal, sendError, withDeps } from './helpers';
import { passkeyStoreFor } from './passkeyAccess';
import { parseAuthenticationBody } from './passkeyJson';
import { startSession } from './sessionDevice';

/** Любой отказ входа ключом отвечает одинаково: по ответу не понять, есть ли такой ключ или пользователь. */
const refuse = (request: FastifyRequest, reply: FastifyReply) =>
  sendError(reply, request, 401, 'passkey_invalid', 'Не удалось войти. Войдите по паролю.', false);

const clientDeviceId = (request: FastifyRequest): string | undefined => {
  const value = request.headers['x-openqareer-device-id'];
  return typeof value === 'string' ? value : undefined;
};

/** Счётчик ключа не убывает; 0 и 0 — ключи, что синхронизируются между устройствами и счёт не ведут. */
export function counterAdvanced(stored: number, reported: number): boolean {
  return stored === 0 && reported === 0 ? true : reported > stored;
}

async function postOptions(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  // Ключ находится по себе (discoverable): список разрешённых пуст, имени пользователя не нужно.
  const options = await generateAuthenticationOptions({
    rpID: passkeyRelyingParty(deps.config).id,
    userVerification: 'required',
  });
  const token = passkeyStoreFor(deps).createChallenge('login', null, options.challenge, new Date());
  return { data: { options, token }, meta: { requestId: request.id } };
}

async function verifyKey(
  deps: RouteDeps,
  key: StoredPasskey,
  challenge: string,
  body: NonNullable<ReturnType<typeof parseAuthenticationBody>>,
) {
  const party = passkeyRelyingParty(deps.config);
  const result = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: [...party.origins],
    expectedRPID: party.id,
    credential: {
      id: key.credentialId,
      publicKey: key.publicKey,
      counter: key.signCount,
      transports: key.transports as never,
    },
    requireUserVerification: true,
  }).catch(() => null);
  const info = result?.authenticationInfo;
  return result?.verified && info?.userVerified && counterAdvanced(key.signCount, info.newCounter)
    ? info.newCounter
    : null;
}

/**
 * Вход ключом: подпись, проверка пользователя (UV) и счётчик. Второй фактор не спрашивается —
 * ключ с отпечатком или лицом уже «устройство + биометрия» (решение владельца).
 */
async function postLogin(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const body = parseAuthenticationBody(request.body);
  const store = passkeyStoreFor(deps);
  const now = new Date();
  const challenge = body ? store.takeChallenge(body.token, 'login', now) : null;
  const key = body && challenge ? store.findByCredentialId(body.response.id) : null;
  // Без флага нового кабинета ключ не виден и не удаляется — значит, и входа по нему нет.
  if (!body || !challenge || !key || !cabinetB640Enabled(deps.config, key.username))
    return refuse(request, reply);
  const newCounter = await verifyKey(deps, key, challenge.challenge, body);
  if (newCounter === null || !store.recordUse(key.id, key.signCount, newCounter, now))
    return refuse(request, reply);
  const authenticated =
    deps.authService.issueSessionForUser?.(key.userId, clientDeviceId(request)) ?? null;
  if (!authenticated) return refuse(request, reply);
  startSession(deps, request, reply, authenticated.sessionToken);
  return {
    data: {
      ...publicPrincipal(authenticated.principal, deps.config),
      sessionToken: authenticated.sessionToken,
    },
    meta: { requestId: request.id },
  };
}

/** B755: вход ключом доступа — до входа, с лимитом на адрес. */
export function registerPasskeyLoginRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/auth/passkey/options',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    withDeps(deps, postOptions),
  );
  app.post(
    '/api/v1/auth/passkey',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    withDeps(deps, postLogin),
  );
}
