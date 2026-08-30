import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RouteDeps } from './deps';
import {
  authenticateSession,
  clearSessionCookie,
  csrfError,
  extractSessionToken,
  fieldMessages,
  hasAllowedOrigin,
  publicPrincipal,
  sendError,
  setSessionCookie,
  withDeps,
} from './helpers';
import {
  accountProfileSchema,
  loginSchema,
  passwordChangeSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  registrationSchema,
} from './schemas';
import { deriveUsernameFromEmail } from '../../shared/accountValidation';
import { LEGAL_DOC_SLUGS } from '../../shared/legalRegistry';
import {
  AuthEmailTakenError,
  AuthInvalidPasswordError,
  AuthInvalidResetTokenError,
  AuthUsernameTakenError,
} from '../auth/authService';

function registrationValidationError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: Parameters<typeof fieldMessages>[0],
) {
  const fields = fieldMessages(error);
  return sendError(
    reply,
    request,
    422,
    'validation_failed',
    Object.values(fields)[0] ?? 'Проверьте заполненные поля.',
    false,
    fields,
  );
}

async function handleRegister(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const parsed = registrationSchema.safeParse(request.body);
  if (!parsed.success) return registrationValidationError(request, reply, parsed.error);
  const body = parsed.data;
  try {
    const authenticated = await deps.authService.register(
      deriveUsernameFromEmail(body.email, (candidate) =>
        deps.authService.isUsernameTaken(candidate),
      ),
      body.password,
      deps.candidateStore,
      {
        email: body.email,
        displayName: body.displayName,
      },
    );
    // The proof is written with the account, so no user can exist without a
    // record of the documents they accepted (B173).
    deps.authService.recordLegalConsent?.({
      userId: authenticated.principal.userId,
      versionId: body.legalConsent.versionId,
      documents: LEGAL_DOC_SLUGS,
    });
    setSessionCookie(reply, authenticated.sessionToken, deps.config.secureCookies);
    return reply.code(201).send({
      data: {
        ...publicPrincipal(authenticated.principal),
        sessionToken: authenticated.sessionToken,
      },
      meta: { requestId: request.id },
    });
  } catch (error) {
    if (error instanceof AuthUsernameTakenError || error instanceof AuthEmailTakenError) {
      // Both collisions now trace back to the address: the handle is
      // derived from it, so the address is the field the candidate can act
      // on. Wording stays identical either way, so a probe cannot tell a
      // taken handle from a taken address.
      const message = 'Этот email уже связан с другим аккаунтом.';
      return sendError(reply, request, 409, 'email_taken', message, false, {
        email: message,
      });
    }
    throw error;
  }
}

async function handleLogin(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) {
    return csrfError(request, reply);
  }
  const body = loginSchema.parse(request.body);
  const authenticated = await deps.authService.login(body.username, body.password);
  if (!authenticated) {
    return sendError(reply, request, 401, 'invalid_credentials', 'Неверный логин или пароль.', false);
  }
  setSessionCookie(reply, authenticated.sessionToken, deps.config.secureCookies);
  return {
    data: {
      ...publicPrincipal(authenticated.principal),
      sessionToken: authenticated.sessionToken,
    },
    meta: { requestId: request.id },
  };
}

async function handleAuthMe(deps: RouteDeps, request: FastifyRequest, _reply: FastifyReply) {
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal) {
    return { data: null, meta: { requestId: request.id } };
  }
  return { data: publicPrincipal(principal), meta: { requestId: request.id } };
}

async function handleLogout(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) {
    return csrfError(request, reply);
  }
  const sessionToken = extractSessionToken(request, deps.config);
  if (sessionToken) {
    deps.authService.logout(sessionToken);
  }
  clearSessionCookie(reply, deps.config.secureCookies);
  return reply.code(204).send();
}

async function handleGetAccount(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const sessionToken = extractSessionToken(request, deps.config);
  const account = deps.authService.getAccount?.(sessionToken) ?? null;
  if (!account) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  return { data: account, meta: { requestId: request.id } };
}

async function handleUpdateProfile(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const sessionToken = extractSessionToken(request, deps.config);
  const body = accountProfileSchema.parse(request.body);
  try {
    const account = deps.authService.updateAccount?.(sessionToken, body) ?? null;
    if (!account) {
      return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
    }
    return { data: account, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof AuthEmailTakenError) {
      return sendError(
        reply,
        request,
        409,
        'email_taken',
        'Этот email уже связан с другим аккаунтом.',
        false,
      );
    }
    throw error;
  }
}

async function handleChangePassword(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const sessionToken = extractSessionToken(request, deps.config);
  const body = passwordChangeSchema.parse(request.body);
  try {
    const authenticated =
      (await deps.authService.changePassword?.(
        sessionToken,
        body.currentPassword,
        body.newPassword,
      )) ?? null;
    if (!authenticated) {
      return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
    }
    setSessionCookie(reply, authenticated.sessionToken, deps.config.secureCookies);
    return {
      data: publicPrincipal(authenticated.principal),
      meta: { requestId: request.id },
    };
  } catch (error) {
    if (error instanceof AuthInvalidPasswordError) {
      return sendError(
        reply,
        request,
        400,
        'current_password_invalid',
        'Текущий пароль указан неверно.',
        false,
      );
    }
    throw error;
  }
}

async function handleRevokeSessions(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const sessionToken = extractSessionToken(request, deps.config);
  const revoked = deps.authService.revokeOtherSessions?.(sessionToken) ?? null;
  if (revoked === null) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  return { data: { revoked }, meta: { requestId: request.id } };
}

async function handlePasswordResetRequest(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const body = passwordResetRequestSchema.parse(request.body);
  try {
    await deps.authService.requestPasswordReset?.(body.identifier);
  } catch (error) {
    request.log.warn(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'password-reset-delivery-failed',
    );
  }
  return reply.code(202).send({
    data: {
      accepted: true,
      deliveryConfigured: Boolean(deps.config.accountEmail),
    },
    meta: { requestId: request.id },
  });
}

async function handlePasswordReset(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const body = passwordResetSchema.parse(request.body);
  try {
    const authenticated = await deps.authService.resetPassword?.(body.token, body.newPassword);
    if (!authenticated) throw new AuthInvalidResetTokenError();
    setSessionCookie(reply, authenticated.sessionToken, deps.config.secureCookies);
    return {
      data: {
        ...publicPrincipal(authenticated.principal),
        sessionToken: authenticated.sessionToken,
      },
      meta: { requestId: request.id },
    };
  } catch (error) {
    if (error instanceof AuthInvalidResetTokenError) {
      return sendError(
        reply,
        request,
        400,
        'password_reset_invalid',
        'Ссылка недействительна или уже истекла.',
        false,
      );
    }
    throw error;
  }
}

export async function registerAuthRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(
    '/api/v1/auth/register',
    { config: { rateLimit: { max: 3, timeWindow: '30 minutes' } } },
    withDeps(deps, handleRegister),
  );
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    withDeps(deps, handleLogin),
  );
  app.get('/api/v1/auth/me', withDeps(deps, handleAuthMe));
  app.post('/api/v1/auth/logout', withDeps(deps, handleLogout));

  app.get('/api/v1/account', withDeps(deps, handleGetAccount));
  app.patch('/api/v1/account/profile', withDeps(deps, handleUpdateProfile));
  app.post('/api/v1/account/password', withDeps(deps, handleChangePassword));
  app.delete('/api/v1/account/sessions', withDeps(deps, handleRevokeSessions));

  app.post(
    '/api/v1/auth/password-reset-requests',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    withDeps(deps, handlePasswordResetRequest),
  );
  app.post(
    '/api/v1/auth/password-resets',
    { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
    withDeps(deps, handlePasswordReset),
  );
}
