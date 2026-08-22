import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { AuthPrincipal, SessionAuth } from '../auth/authService';
import type { ServerConfig } from '../config';
import type { CandidateIdentity, CandidateStore } from '../data/candidateStore';
import { OAUTH_PLATFORMS, type OAuthPlatform } from '../connectors/oauthTypes';
import { OAuthConnectorError } from '../connectors/oauthConnector';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    /**
     * Per-field messages for form submissions. Without these a rejected
     * registration collapses into one anonymous line and the candidate cannot
     * tell which field to fix (B139).
     */
    fields?: Record<string, string>;
  };
}

/**
 * Binds a module-level route handler to its dependencies. Keeps every handler
 * and every registrar under the 50-line function gate: registrars stay flat
 * declaration lists, handlers are plain functions of `(deps, request, reply)`.
 */
export function withDeps<D>(
  deps: D,
  handler: (deps: D, request: FastifyRequest, reply: FastifyReply) => unknown,
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (request, reply) => handler(deps, request, reply);
}

export function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  code: string,
  message: string,
  retryable: boolean,
  fields?: Record<string, string>,
): FastifyReply {
  const body: ErrorBody = {
    error: {
      code,
      message,
      requestId: request.id,
      retryable,
      ...(fields && Object.keys(fields).length > 0 ? { fields } : {}),
    },
  };
  return reply.code(statusCode).send(body);
}

/** Turns a Zod failure into the `{ field: message }` map the forms render. */
export function fieldMessages(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && !(field in fields)) {
      fields[field] = issue.message;
    }
  }
  return fields;
}

export function hasAllowedOrigin(request: FastifyRequest, config: ServerConfig): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    // If request carries Bearer authorization, allow desktop/native companion client
    if (request.headers.authorization?.startsWith('Bearer ')) {
      return true;
    }
    return false;
  }
  return config.allowedOrigins.includes(origin);
}

export function hasSafeMutationOrigin(request: FastifyRequest, config: ServerConfig): boolean {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return true;
  }
  return hasAllowedOrigin(request, config);
}

export function csrfError(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(
    reply,
    request,
    403,
    'origin_not_allowed',
    'Запрос отклонён: источник страницы не подтверждён.',
    false,
  );
}

function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-openqareer_session' : 'openqareer_session';
}

export function setSessionCookie(reply: FastifyReply, sessionToken: string, secure: boolean): void {
  reply.setCookie(sessionCookieName(secure), sessionToken, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: 12 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(sessionCookieName(secure), {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'strict',
  });
}

export function extractSessionToken(request: FastifyRequest, config: ServerConfig): string {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    const bearer = authorization.slice('Bearer '.length).trim();
    if (bearer && !bearer.startsWith('oqc_')) {
      return bearer;
    }
  }
  return request.cookies[sessionCookieName(config.secureCookies)] ?? '';
}

export function authenticateSession(
  request: FastifyRequest,
  authService: SessionAuth,
  config: ServerConfig,
): AuthPrincipal | null {
  const sessionToken = extractSessionToken(request, config);
  return authService.authenticate(sessionToken);
}

export function authenticateCandidate(
  request: FastifyRequest,
  reply: FastifyReply,
  candidateStore: CandidateStore,
  authService: SessionAuth,
  config: ServerConfig,
): CandidateIdentity | null {
  const authorization = request.headers.authorization;
  const accessToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const bearerCandidate = candidateStore.authenticate(accessToken);
  const sessionCandidate = authenticateSession(request, authService, config)?.candidate ?? null;
  const candidate = bearerCandidate ?? sessionCandidate;
  if (!candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return candidate;
}

export function publicPrincipal(principal: AuthPrincipal) {
  return {
    username: principal.username,
    email: principal.email,
    displayName: principal.displayName,
    role: principal.role,
    isTest: principal.isTest,
    candidateId: principal.candidate?.id ?? null,
  };
}

export function hasPreviewAccess(request: FastifyRequest, expectedToken: string): boolean {
  const authorization = request.headers.authorization;
  const suppliedToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  return secureEqual(suppliedToken, expectedToken);
}

export function previewAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authorization = request.headers.authorization;
    const suppliedToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (!secureEqual(suppliedToken, expectedToken)) {
      sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
    }
  };
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function encodeHeaderFileName(fileName: string): string {
  return encodeURIComponent(fileName).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function parsePlatform(value: string): OAuthPlatform | null {
  return (OAUTH_PLATFORMS as readonly string[]).includes(value) ? (value as OAuthPlatform) : null;
}

export function connectorNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(
    reply,
    request,
    404,
    'connector_not_found',
    'Такая площадка не подключается.',
    false,
  );
}

export function sendConnectorError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): FastifyReply {
  if (!(error instanceof OAuthConnectorError)) throw error;
  return sendError(
    reply,
    request,
    error.statusCode,
    error.code,
    connectorMessage(error.code),
    error.retryable,
  );
}

function connectorMessage(code: OAuthConnectorError['code']): string {
  switch (code) {
    case 'connector_not_configured':
      return 'Подключение этой площадки ещё не настроено администратором.';
    case 'oauth_state_invalid':
      return 'Ссылка подключения истекла или уже использована. Начните подключение заново.';
    case 'provider_oauth_failed':
      return 'Площадка не подтвердила доступ. Повторите подключение позже.';
    case 'provider_profile_unavailable':
      return 'Площадка не вернула профиль по выданному доступу.';
  }
}

/**
 * The callback is opened by the platform authorization server in the
 * candidate's browser, so the outcome is always handed to a fixed same-origin
 * route. A caller-provided return URL is never accepted.
 */
export function connectionResultRedirect(
  reply: FastifyReply,
  platform: OAuthPlatform,
  status: 'connected' | 'declined' | 'failed',
  reason?: OAuthConnectorError['code'],
): FastifyReply {
  const query = new URLSearchParams({ platform, status });
  if (reason) query.set('reason', reason);
  return reply.redirect(`/connections/result?${query.toString()}`, 303);
}
