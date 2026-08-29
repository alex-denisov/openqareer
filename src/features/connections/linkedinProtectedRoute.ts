import {
  probeNetworkStatus,
  startTunnel,
  stopTunnel,
  type NetworkEnvironmentStatus,
  type PlatformProbeResult,
  type TunnelConfig,
  type TunnelStatusReport,
} from '../../services/desktop/desktopBridge';
import { apiFetch } from '../coach/apiClient';

export type ProtectedRouteErrorCode =
  | 'session_expired'
  | 'bootstrap_unavailable'
  | 'bootstrap_invalid'
  | 'tunnel_start_failed';

/**
 * Says which boundary refused, in the candidate's words. One sentence for four
 * different failures ("маршрут не запустился") sent the owner restarting the
 * app for a problem that was never in the app (B157).
 */
export function protectedRouteFailureMessage(reason: unknown): string {
  const code = reason instanceof ProtectedRouteError ? reason.code : undefined;
  switch (code) {
    case 'bootstrap_unavailable':
      return 'Сервер OpenQareer сейчас не выдаёт доступ к защищённому маршруту LinkedIn. Повторите через минуту или загрузите PDF-экспорт профиля.';
    case 'bootstrap_invalid':
      return 'Ответ сервера о защищённом маршруте LinkedIn не распознан. Обновите приложение до свежей версии или загрузите PDF-экспорт профиля.';
    case 'tunnel_start_failed':
      return 'Защищённый EU-маршрут LinkedIn не поднялся на этом компьютере. Проверьте сеть и повторите попытку или загрузите PDF-экспорт профиля.';
    default:
      return 'Подключиться к LinkedIn не удалось до открытия окна входа. Повторите попытку или загрузите PDF-экспорт профиля.';
  }
}

export class ProtectedRouteError extends Error {
  constructor(readonly code: ProtectedRouteErrorCode) {
    super(code);
    this.name = 'ProtectedRouteError';
  }
}

interface ProtectedRouteDependencies {
  readonly probeNetwork?: () => Promise<NetworkEnvironmentStatus | null>;
  readonly fetchBootstrap?: () => Promise<Response>;
  readonly startTunnel?: (config: TunnelConfig) => Promise<TunnelStatusReport>;
}

interface ProtectedRouteEndDependencies {
  readonly stopTunnel?: () => Promise<TunnelStatusReport | null>;
}

/**
 * Releases the protected route raised for a sign-in session. `startTunnel` had
 * no counterpart, so a tunnel opened for LinkedIn outlived the session that
 * needed it and only ended with the application (PRB-010). Closing a session is
 * never allowed to fail because the tunnel refused to stop.
 */
export async function endLinkedInProtectedRoute(
  dependencies: ProtectedRouteEndDependencies = {},
): Promise<void> {
  try {
    await (dependencies.stopTunnel ?? stopTunnel)();
  } catch {
    // Nothing the candidate can act on: the session is closing either way.
  }
}

export interface ProtectedRouteResult {
  /** `null` when the route was never measured — unknown, not reachable. */
  readonly probe: PlatformProbeResult | null;
  readonly tunnelActive: boolean;
}

/**
 * Resolves the complete protected-route boundary: current direct reachability,
 * an authenticated candidate-scoped bootstrap, and a sidecar status that was
 * earned by its live proxy probe. A 401 is an account-session failure, not a
 * tunnel failure, and callers must never collapse those two states again.
 *
 * An absent measurement is not a working direct route: when the probe reports
 * nothing, the protected route is raised instead of shortcutting past it (B167).
 */
export async function startLinkedInProtectedRoute(
  dependencies: ProtectedRouteDependencies = {},
): Promise<ProtectedRouteResult> {
  const probe = await (dependencies.probeNetwork ?? probeNetworkStatus)();
  if (probe?.linkedin.accessible) {
    return { probe: probe.linkedin, tunnelActive: false };
  }

  const response = await (
    dependencies.fetchBootstrap ?? (() => apiFetch('/api/v1/candidate/desktop-tunnel'))
  )();
  if (response.status === 401) {
    throw new ProtectedRouteError('session_expired');
  }
  if (!response.ok) {
    throw new ProtectedRouteError('bootstrap_unavailable');
  }

  let payload: { data?: TunnelConfig };
  try {
    payload = (await response.json()) as { data?: TunnelConfig };
  } catch {
    throw new ProtectedRouteError('bootstrap_invalid');
  }
  if (!payload.data) {
    throw new ProtectedRouteError('bootstrap_invalid');
  }

  let tunnel: TunnelStatusReport;
  try {
    tunnel = await (dependencies.startTunnel ?? startTunnel)(payload.data);
  } catch {
    throw new ProtectedRouteError('tunnel_start_failed');
  }
  if (tunnel.state !== 'running') {
    throw new ProtectedRouteError('tunnel_start_failed');
  }
  return { probe: probe?.linkedin ?? null, tunnelActive: true };
}
