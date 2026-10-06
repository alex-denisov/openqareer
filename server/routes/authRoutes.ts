import { createHash } from 'node:crypto';
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
  requireVerifiedEmail,
  sessionCameFromCookie,
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
  emailVerificationCodeSchema,
  changeUnverifiedEmailSchema,
} from './schemas';
import { deriveUsernameFromEmail } from '../../shared/accountValidation';
import { LEGAL_DOC_SLUGS } from '../../shared/legalRegistry';
import {
  AuthEmailTakenError,
  AuthInvalidPasswordError,
  AuthInvalidResetTokenError,
  AuthUsernameTakenError,
  AuthDisposableEmailError,
  AuthEmailDomainUnreachableError,
  AuthEmailChangeRequiresVerificationError,
} from '../auth/authService';
import {
  AuthEmailVerificationDeliveryError,
  AuthEmailVerificationExpiredError,
  AuthEmailVerificationInvalidCodeError,
  AuthEmailVerificationLockedError,
  AuthEmailVerificationNotRequiredError,
  AuthEmailVerificationRateLimitError,
  AuthEmailVerificationResendTooSoonError,
} from '../auth/authErrors';
import {
  defaultRegistrationLimiter,
  parseClientFingerprint,
  toRegistrationFingerprintLog,
} from '../auth/registrationAntiAbuse';

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

function clientDeviceIdFrom(request: FastifyRequest): string | undefined {
  const deviceId = request.headers['x-openqareer-device-id'];
  return typeof deviceId === 'string' ? deviceId : undefined;
}

async function handleRegister(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const parsed = registrationSchema.safeParse(request.body);
  if (!parsed.success) return registrationValidationError(request, reply, parsed.error);
  const body = parsed.data;

  if (await rejectRegistrationIfLimited(deps, request, reply)) return reply;

  try {
    const username = deriveUsernameFromEmail(body.email, (candidate) =>
      deps.authService.isUsernameTaken(candidate),
    );
    const profile = { email: body.email, displayName: body.displayName, clientIp: request.ip };
    const deviceId = clientDeviceIdFrom(request);
    const authenticated = deviceId
      ? await deps.authService.register(username, body.password, deps.candidateStore, profile, deviceId)
      : await deps.authService.register(username, body.password, deps.candidateStore, profile);
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
    return registrationFailure(error, request, reply);
  }
}

function registrationFailure(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AuthEmailDomainUnreachableError) {
    return sendError(reply, request, 422, 'email_domain_unreachable', error.message, false, {
      email: error.message,
    });
  }
  if (error instanceof AuthDisposableEmailError) {
    return sendError(reply, request, 422, 'disposable_email_rejected', error.message, false, {
      email: error.message,
    });
  }
  if (error instanceof AuthUsernameTakenError || error instanceof AuthEmailTakenError) {
    // Both collisions now trace back to the address: the handle is derived
    // from it, so wording stays identical for either collision.
    const message = 'Этот email уже связан с другим аккаунтом.';
    return sendError(reply, request, 409, 'email_taken', message, false, { email: message });
  }
  throw error;
}

async function rejectRegistrationIfLimited(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (/^test/u.test(deps.config.release)) return false;
  const fingerprint = parseClientFingerprint(request.headers, request.ip || '127.0.0.1');
  request.log.info(
    toRegistrationFingerprintLog(fingerprint, deps.config.dataEncryptionKey),
    'registration_fingerprint',
  );
  const velocity = defaultRegistrationLimiter.checkAndRecord(fingerprint.subnet);
  if (velocity.allowed) return false;
  const message = velocity.retryAfterSeconds
    ? `Слишком много регистраций из вашей сети. Попробуйте через ${velocity.retryAfterSeconds} с.`
    : 'Слишком много регистраций из вашей сети. Пожалуйста, подождите или обратитесь в поддержку.';
  sendError(reply, request, 429, 'rate_limit_exceeded', message, false);
  return true;
}

async function handleLogin(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) {
    return csrfError(request, reply);
  }
  const body = loginSchema.parse(request.body);
  const deviceId = clientDeviceIdFrom(request);
  const authenticated = deviceId
    ? await deps.authService.login(body.username, body.password, deviceId)
    : await deps.authService.login(body.username, body.password);
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

function verificationFailure(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AuthEmailVerificationInvalidCodeError) {
    return sendError(reply, request, 422, 'email_verification_invalid', error.message, false);
  }
  if (error instanceof AuthEmailVerificationExpiredError) {
    return sendError(reply, request, 410, 'email_verification_expired', error.message, false);
  }
  if (error instanceof AuthEmailVerificationLockedError) {
    return sendError(reply, request, 429, 'email_verification_locked', error.message, false);
  }
  if (
    error instanceof AuthEmailVerificationRateLimitError ||
    error instanceof AuthEmailVerificationResendTooSoonError
  ) {
    reply.header('Retry-After', String(error.retryAfterSeconds));
    return sendError(
      reply,
      request,
      429,
      'email_verification_rate_limited',
      error.message,
      true,
      undefined,
      { retryAfterSeconds: error.retryAfterSeconds },
    );
  }
  if (error instanceof AuthEmailVerificationDeliveryError) {
    return sendError(reply, request, 503, 'email_verification_delivery_failed', error.message, true);
  }
  if (error instanceof AuthEmailVerificationNotRequiredError) {
    return sendError(reply, request, 409, 'email_already_verified', error.message, false);
  }
  if (error instanceof AuthInvalidPasswordError) {
    return sendError(reply, request, 400, 'current_password_invalid', error.message, false);
  }
  if (error instanceof AuthEmailTakenError) {
    return sendError(reply, request, 409, 'email_taken', 'Этот email уже связан с другим аккаунтом.', false);
  }
  if (error instanceof AuthEmailDomainUnreachableError || error instanceof AuthDisposableEmailError) {
    return sendError(reply, request, 422, 'email_invalid', error.message, false);
  }
  return null;
}

async function handleVerifyEmail(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const parsed = emailVerificationCodeSchema.safeParse(request.body);
  if (!parsed.success) return registrationValidationError(request, reply, parsed.error);
  const sessionToken = extractSessionToken(request, deps.config);
  try {
    const authenticated = (await deps.authService.verifyEmail?.(sessionToken, parsed.data.code)) ?? null;
    if (!authenticated) {
      return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
    }
    setSessionCookie(reply, authenticated.sessionToken, deps.config.secureCookies);
    return {
      data: { ...publicPrincipal(authenticated.principal), sessionToken: authenticated.sessionToken },
      meta: { requestId: request.id },
    };
  } catch (error) {
    const mapped = verificationFailure(error, request, reply);
    if (mapped) return mapped;
    throw error;
  }
}

async function handleResendEmailVerification(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const sessionToken = extractSessionToken(request, deps.config);
  try {
    const result =
      (await deps.authService.resendEmailVerification?.(sessionToken, request.ip)) ?? null;
    if (!result) {
      return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
    }
    setSessionCookie(reply, sessionToken, deps.config.secureCookies);
    return {
      data: {
        ...publicPrincipal(result.principal),
        emailVerificationEmailSent: result.emailVerificationEmailSent,
        sessionToken,
      },
      meta: { requestId: request.id },
    };
  } catch (error) {
    const mapped = verificationFailure(error, request, reply);
    if (mapped) return mapped;
    throw error;
  }
}

async function handleChangeUnverifiedEmail(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const parsed = changeUnverifiedEmailSchema.safeParse(request.body);
  if (!parsed.success) return registrationValidationError(request, reply, parsed.error);
  const sessionToken = extractSessionToken(request, deps.config);
  try {
    const result =
      (await deps.authService.changeUnverifiedEmail?.(
        sessionToken,
        parsed.data.email,
        parsed.data.currentPassword,
        request.ip,
      )) ?? null;
    if (!result) {
      return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
    }
    setSessionCookie(reply, sessionToken, deps.config.secureCookies);
    return {
      data: {
        ...publicPrincipal(result.principal),
        emailVerificationEmailSent: result.emailVerificationEmailSent,
        sessionToken,
      },
      meta: { requestId: request.id },
    };
  } catch (error) {
    const mapped = verificationFailure(error, request, reply);
    if (mapped) return mapped;
    throw error;
  }
}

async function handleAuthMe(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal) {
    return { data: null, meta: { requestId: request.id } };
  }
  // Сервер уже продлил сессию; браузерная cookie продлевается здесь же, иначе
  // она умирала бы по своему сроку при живой серверной сессии (PRB-038).
  if (sessionCameFromCookie(request, deps.config)) {
    setSessionCookie(reply, extractSessionToken(request, deps.config), deps.config.secureCookies);
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
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  if (!requireVerifiedEmail(request, reply, principal)) return undefined;
  const account = deps.authService.getAccount?.(sessionToken) ?? null;
  if (!account) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  return { data: account, meta: { requestId: request.id } };
}

async function handleUpdateProfile(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const sessionToken = extractSessionToken(request, deps.config);
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  if (!requireVerifiedEmail(request, reply, principal)) return undefined;
  const body = accountProfileSchema.parse(request.body);
  try {
    const account = deps.authService.updateAccount?.(sessionToken, body) ?? null;
    if (!account) {
      return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
    }
    return { data: account, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof AuthEmailChangeRequiresVerificationError) {
      return sendError(
        reply,
        request,
        409,
        'email_change_requires_verification',
        error.message,
        false,
      );
    }
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
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  if (!requireVerifiedEmail(request, reply, principal)) return undefined;
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
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  if (!requireVerifiedEmail(request, reply, principal)) return undefined;
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

function emailVerificationRateLimitKey(deps: RouteDeps, request: FastifyRequest): string {
  const principal = authenticateSession(request, deps.authService, deps.config);
  const body = request.body as { email?: unknown } | undefined;
  const email =
    typeof body?.email === 'string'
      ? body.email.trim().toLowerCase()
      : (principal?.email ?? '').trim().toLowerCase();
  const identity = email || principal?.userId || 'anonymous';
  const digest = createHash('sha256').update(identity).digest('hex');
  return `${request.ip}:${digest}`;
}

export async function registerAuthRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(
    '/api/v1/auth/register',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '30 minutes',
          keyGenerator: (request) => emailVerificationRateLimitKey(deps, request),
        },
      },
    },
    withDeps(deps, handleRegister),
  );
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    withDeps(deps, handleLogin),
  );
  app.get('/api/v1/auth/me', withDeps(deps, handleAuthMe));
  app.post('/api/v1/auth/logout', withDeps(deps, handleLogout));

  registerEmailVerificationRoutes(app, deps);

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

function registerEmailVerificationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const rateLimit = (max: number, timeWindow: string) => ({
    config: {
      rateLimit: { max, timeWindow, keyGenerator: (request: FastifyRequest) => emailVerificationRateLimitKey(deps, request) },
    },
  });
  app.post('/api/v1/auth/email-verification/verify', rateLimit(10, '15 minutes'), withDeps(deps, handleVerifyEmail));
  app.post('/api/v1/auth/email-verification/resend', rateLimit(5, '1 hour'), withDeps(deps, handleResendEmailVerification));
  app.patch('/api/v1/auth/email-verification/address', rateLimit(5, '1 hour'), withDeps(deps, handleChangeUnverifiedEmail));
}
