import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { z } from 'zod';
import { profileImportSchema } from './schemas';
import {
  deriveImportedFactSources,
  listCandidateConnectionViews,
} from '../connectors/nativeSourceConnection';

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

const importWalkSchema = z.object({
  state: z.enum(['running', 'done']),
  sections: z
    .array(
      z.object({
        key: z.string().regex(/^[a-zA-Z]{1,40}$/u),
        status: z.enum(['read', 'pending', 'failed']),
      }),
    )
    .max(20),
});
const walkPlatformSchema = z.enum(['linkedin', 'hh']);

/** B541: the walk of a source's sections, kept so the profile shows it after a reload. */
async function handleSaveImportWalk(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return;
  const platform = walkPlatformSchema.safeParse((request.params as { platform: string }).platform);
  const body = importWalkSchema.safeParse(request.body);
  if (!platform.success || !body.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_import_walk',
      'Неверное состояние обхода.',
      false,
    );
  }
  const walk = { platform: platform.data, ...body.data, updatedAt: new Date().toISOString() };
  deps.candidateStore.saveImportWalk(candidate.id, walk);
  return { data: walk, meta: { requestId: request.id } };
}

async function handleListConnections(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return;
  const snapshot = deps.candidateStore.getSnapshot(candidate.id);
  const walks = new Map(
    snapshot.importedSources.flatMap((source) =>
      source.walk ? [[source.platform, source.walk]] : [],
    ),
  );
  return {
    data: listCandidateConnectionViews(
      deps.candidateStore.listNativeSourceConnections(candidate.id),
      deriveImportedFactSources(snapshot.messages, snapshot.memory),
    ).map((view) => {
      const walk = walks.get(view.platform);
      return walk ? { ...view, walk } : view;
    }),
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
  app.put<{ Params: { platform: string } }>(
    '/api/v1/candidate/connections/:platform/walk',
    { config: { rateLimit: { max: 120, timeWindow: '15 minutes' } } },
    withDeps(deps, handleSaveImportWalk),
  );
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
