import {
  probeNetworkStatus,
  startTunnel,
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

export class ProtectedRouteError extends Error {
  constructor(readonly code: ProtectedRouteErrorCode) {
    super(code);
    this.name = 'ProtectedRouteError';
  }
}

interface ProtectedRouteDependencies {
  readonly probeNetwork?: () => Promise<NetworkEnvironmentStatus>;
  readonly fetchBootstrap?: () => Promise<Response>;
  readonly startTunnel?: (config: TunnelConfig) => Promise<TunnelStatusReport>;
}

export interface ProtectedRouteResult {
  readonly probe: PlatformProbeResult;
  readonly tunnelActive: boolean;
}

/**
 * Resolves the complete protected-route boundary: current direct reachability,
 * an authenticated candidate-scoped bootstrap, and a sidecar status that was
 * earned by its live proxy probe. A 401 is an account-session failure, not a
 * tunnel failure, and callers must never collapse those two states again.
 */
export async function startLinkedInProtectedRoute(
  dependencies: ProtectedRouteDependencies = {},
): Promise<ProtectedRouteResult> {
  const probe = await (dependencies.probeNetwork ?? probeNetworkStatus)();
  if (probe.linkedin.accessible) {
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
  return { probe: probe.linkedin, tunnelActive: true };
}
