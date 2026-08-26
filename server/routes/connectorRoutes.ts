import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { profileImportSchema } from './schemas';
import { listCandidateConnectionViews } from '../connectors/nativeSourceConnection';

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
    data: listCandidateConnectionViews(
      deps.candidateStore.listNativeSourceConnections(candidate.id),
    ),
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
  const platform = (request.params as { platform: string }).platform;
  return {
    data: {
      platform,
      status: 'disconnected',
      accessMode: 'native_session_snapshot',
      connectionRemoved: deps.candidateStore.deleteNativeSourceConnection(
        candidate.id,
        platform as 'hh' | 'linkedin',
      ),
      providerSession: 'not_managed',
      importedData: 'retained',
    },
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
  app.delete<{ Params: { platform: string } }>(
    '/api/v1/candidate/connections/:platform',
    withDeps(deps, handleDisconnect),
  );
}
