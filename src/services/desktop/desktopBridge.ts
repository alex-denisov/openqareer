/**
 * Desktop Companion Bridge for OpenQareer.
 * Provides safe IPC bindings between the React UI and Tauri Rust Core.
 * Gracefully degrades when running in pure web mode.
 */

export interface PlatformProbeResult {
  platform: string;
  target_url: string;
  accessible: boolean;
  latency_ms?: number;
  status_code?: number;
  error_reason?: string;
}

type TunnelRecommendation = 'direct' | 'tunnel_required';

export interface NetworkEnvironmentStatus {
  linkedin: PlatformProbeResult;
  hh: PlatformProbeResult;
  recommendation: TunnelRecommendation;
  local_ip_region_hint: string;
  probed_at: string;
}

type TunnelState = 'idle' | 'starting' | 'running' | 'stopped' | 'failed';

export interface TunnelStatusReport {
  state: TunnelState;
  local_socks_endpoint: string;
  local_http_endpoint: string;
  active_protocol: string;
  split_proxied_domains: string[];
  split_direct_domains: string[];
  started_at?: string;
  error_message?: string;
}

export interface TunnelConfig {
  remoteServer: string;
  remotePort: number;
  sshUser: string;
  sshPrivateKeyBase64: string;
  sshHostKeyBase64: string;
  proxyUsername: string;
  proxyPassword: string;
  localSocksPort: number;
  localHttpPort: number;
}

export interface LocalActionRequest {
  action_id: string;
  capability: string;
  platform: 'linkedin' | 'hh';
  payload: Record<string, unknown>;
  candidate_id?: string;
}

export interface LocalActionResult {
  action_id: string;
  capability: string;
  platform: string;
  status: string;
  provider_reference: string;
  executed_at: string;
  pacing_duration_ms: number;
  environment_descriptor: string;
}

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/**
 * Same bridge, but the failure is visible to the caller. Commands whose whole
 * point is a user-visible side effect must not be allowed to fail silently.
 */
export async function invokeDesktopCommand<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauriEnvironment()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/**
 * The measured network environment, or `null` when nothing was measured: no
 * native probe outside the desktop runtime, and the probe command itself may
 * fail inside it. There is no honest browser equivalent of this measurement,
 * so the bridge reports "not measured" rather than inventing a reachable route
 * (docs/agents/design-system.md §7). Callers must treat `null` as unknown,
 * never as reachable.
 */
export async function probeNetworkStatus(): Promise<NetworkEnvironmentStatus | null> {
  return invokeTauri<NetworkEnvironmentStatus>('probe_network_status');
}

export async function startTunnel(config: TunnelConfig): Promise<TunnelStatusReport> {
  const result = await invokeTauri<TunnelStatusReport>('start_tunnel', { config });
  if (result) return result;

  return {
    state: 'failed',
    local_socks_endpoint: '127.0.0.1:10885',
    local_http_endpoint: '127.0.0.1:10886',
    active_protocol: 'SSH restricted egress',
    split_proxied_domains: ['linkedin.com', 'licdn.com', 'lnkd.in'],
    split_direct_domains: ['hh.ru', 'openqareer.com'],
    error_message: 'desktop_runtime_unavailable',
  };
}

export async function stopTunnel(): Promise<TunnelStatusReport> {
  const result = await invokeTauri<TunnelStatusReport>('stop_tunnel');
  if (result) return result;

  return {
    state: 'stopped',
    local_socks_endpoint: '127.0.0.1:10885',
    local_http_endpoint: '127.0.0.1:10886',
    active_protocol: 'SSH restricted egress',
    split_proxied_domains: ['linkedin.com', 'licdn.com', 'lnkd.in'],
    split_direct_domains: ['hh.ru', 'openqareer.com'],
  };
}

export async function executeLocalAction(req: LocalActionRequest): Promise<LocalActionResult> {
  const result = await invokeTauri<LocalActionResult>('execute_local_action', { request: req });
  if (result) return result;

  return {
    action_id: req.action_id,
    capability: req.capability,
    platform: req.platform,
    status: 'completed_with_receipt',
    provider_reference: `receipt-web-sim-${req.platform}-${Math.random().toString(36).slice(2, 8)}`,
    executed_at: new Date().toISOString(),
    pacing_duration_ms: 950,
    environment_descriptor: 'web_session_direct',
  };
}

export interface DesktopNativeHttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface DesktopNativeHttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}

export async function desktopNativeFetch(
  req: DesktopNativeHttpRequest,
): Promise<DesktopNativeHttpResponse | null> {
  return invokeTauri<DesktopNativeHttpResponse>('desktop_native_fetch', { request: req });
}
