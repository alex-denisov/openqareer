import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  connectionResultRedirect,
  connectorNotFound,
  csrfError,
  hasSafeMutationOrigin,
  parsePlatform,
  sendConnectorError,
  sendError,
  withDeps,
} from './helpers';
import { oauthCallbackQuerySchema, profileImportSchema } from './schemas';
import { OAuthConnectorError } from '../connectors/oauthConnector';

async function handleProfileImport(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return;
  const body = profileImportSchema.parse(request.body);
  return {
    data: await deps.importProfile(body.url),
    meta: { requestId: request.id },
  };
}

async function handleListConnections(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return;
  return {
    data: deps.oauthService.listConnections(candidate.id),
    meta: { requestId: request.id },
  };
}

async function handleDesktopTunnel(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return;
  if (!deps.config.desktopTunnel) {
    return sendError(
      reply,
      request,
      503,
      'desktop_tunnel_unavailable',
      'Защищённый маршрут LinkedIn сейчас не настроен.',
      true,
    );
  }
  return { data: deps.config.desktopTunnel, meta: { requestId: request.id } };
}

async function handleStartAuthorization(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return;
  const platform = parsePlatform((request.params as { platform: string }).platform);
  if (!platform) return connectorNotFound(request, reply);
  try {
    return reply.code(201).send({
      data: deps.oauthService.startAuthorization(candidate.id, platform),
      meta: { requestId: request.id },
    });
  } catch (error) {
    return sendConnectorError(request, reply, error);
  }
}

async function handleOAuthCallback(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const platform = parsePlatform((request.params as { platform: string }).platform);
  if (!platform) return connectorNotFound(request, reply);
  const callback = oauthCallbackQuerySchema.parse(request.query);
  if (callback.error) {
    deps.oauthService.declineAuthorization(platform, callback.state);
    return connectionResultRedirect(reply, platform, 'declined');
  }
  try {
    await deps.oauthService.completeAuthorization(platform, {
      state: callback.state,
      code: callback.code ?? '',
    });
  } catch (error) {
    request.log.warn(
      {
        platform,
        errorCode: error instanceof OAuthConnectorError ? error.code : 'internal_error',
      },
      'connector-callback-failed',
    );
    return connectionResultRedirect(
      reply,
      platform,
      'failed',
      error instanceof OAuthConnectorError ? error.code : 'provider_oauth_failed',
    );
  }
  return connectionResultRedirect(reply, platform, 'connected');
}

async function handleDisconnect(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return;
  const platform = parsePlatform((request.params as { platform: string }).platform);
  if (!platform) return connectorNotFound(request, reply);
  return {
    data: await deps.oauthService.disconnect(candidate.id, platform),
    meta: { requestId: request.id },
  };
}

export async function registerConnectorRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.post(
    '/api/v1/candidate/profile-imports',
    { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
    withDeps(deps, handleProfileImport),
  );
  app.get('/api/v1/candidate/connections', withDeps(deps, handleListConnections));
  app.get(
    '/api/v1/candidate/desktop-tunnel',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    withDeps(deps, handleDesktopTunnel),
  );
  app.post<{ Params: { platform: string } }>(
    '/api/v1/candidate/connections/:platform/authorizations',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    withDeps(deps, handleStartAuthorization),
  );
  app.get<{ Params: { platform: string } }>(
    '/api/v1/connectors/:platform/callback',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    withDeps(deps, handleOAuthCallback),
  );
  app.delete<{ Params: { platform: string } }>(
    '/api/v1/candidate/connections/:platform',
    withDeps(deps, handleDisconnect),
  );
}
