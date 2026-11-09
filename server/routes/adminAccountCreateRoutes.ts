import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { deriveUsernameFromEmail } from '../../shared/accountValidation';
import { LEGAL_DOC_SLUGS, LEGAL_PACK_VERSION_ID } from '../../shared/legalRegistry';
import { requireAdminMutation } from './adminAuth';
import { registrationFailure } from './authRoutes';
import type { RouteDeps } from './deps';
import { fieldMessages, sendError, withDeps } from './helpers';
import { adminAccountCreateSchema } from './schemas';
import type { AuthPrincipal } from '../auth/authTypes';
import type { z } from 'zod';

type AdminAccountCreateInput = z.infer<typeof adminAccountCreateSchema>;

/**
 * The owner creates a candidate account by hand. It reuses the public
 * registration path (same hashing, same candidate record), but skips the
 * public velocity limit, never keeps the session it opens, and records the
 * legal acceptance and the act itself as done by the administrator.
 */
async function handleCreateAccount(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const admin = requireAdminMutation(deps, request, reply);
  if (!admin) return;
  const parsed = adminAccountCreateSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    const fields = fieldMessages(parsed.error);
    const message = Object.values(fields)[0] ?? 'Проверьте заполненные поля.';
    return sendError(reply, request, 422, 'validation_failed', message, false, fields);
  }
  const body = parsed.data;
  try {
    const username = deriveUsernameFromEmail(body.email, (candidate) =>
      deps.authService.isUsernameTaken(candidate),
    );
    const created = await deps.authService.register(
      username,
      body.password,
      deps.candidateStore,
      {
        email: body.email,
        displayName: body.displayName,
        emailVerified: body.emailVerified,
        clientIp: request.ip,
      },
      undefined,
      (failure) => request.log.warn(failure, 'admin-create-email-verification-failed'),
    );
    deps.authService.logout(created.sessionToken);
    const userId = created.principal.userId;
    deps.authService.recordLegalConsent?.({
      userId,
      versionId: LEGAL_PACK_VERSION_ID,
      documents: LEGAL_DOC_SLUGS,
    });
    if (body.subscriptionTier) {
      deps.authService.updateUserByAdmin?.(
        userId,
        { subscriptionTier: body.subscriptionTier },
        admin,
      );
    }
    recordCreation(deps, admin, userId, created.principal.username, body);
    return sendCreated(deps, request, reply, userId);
  } catch (error) {
    return registrationFailure(error, request, reply);
  }
}

function recordCreation(
  deps: RouteDeps,
  admin: AuthPrincipal,
  userId: string,
  username: string,
  body: AdminAccountCreateInput,
): void {
  deps.authService.recordAdminAction?.({
    actor: admin,
    action: 'user.create',
    subjectUserId: userId,
    subjectUsername: username,
    detail: JSON.stringify({
      emailVerified: body.emailVerified,
      subscriptionTier: body.subscriptionTier ?? 'free',
      legalConsent: { versionId: LEGAL_PACK_VERSION_ID, acceptedBy: 'admin' },
    }),
  });
}

function sendCreated(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
) {
  const user = deps.authService.getUser?.(userId) ?? { id: userId };
  return reply.code(201).send({ data: user, meta: { requestId: request.id } });
}

export function registerAdminAccountCreateRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/v1/admin/users', withDeps(deps, handleCreateAccount));
}
