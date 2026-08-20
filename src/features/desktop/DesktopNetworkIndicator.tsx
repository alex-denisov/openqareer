import { useEffect, useState } from 'react';
import { ArrowsClockwise, Lightning, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import {
  getDesktopInfo,
  getTunnelStatus,
  probeNetworkStatus,
  type DesktopInfo,
  type NetworkEnvironmentStatus,
  type TunnelStatusReport,
} from '../../services/desktop/desktopBridge';

function IndicatorLabel({
  loading,
  isDirect,
  isTunnelActive,
}: {
  loading: boolean;
  isDirect: boolean;
  isTunnelActive: boolean;
}) {
  if (loading) {
    return (
      <>
        <ArrowsClockwise size={14} className="career-spin" />
        <span>Проверка сети…</span>
      </>
    );
  }
  if (isDirect) {
    return (
      <>
        <ShieldCheck size={16} weight="bold" />
        <span>Прямой маршрут (VPN)</span>
      </>
    );
  }
  if (isTunnelActive) {
    return (
      <>
        <Lightning size={16} weight="fill" />
        <span>Защищённый маршрут активен</span>
      </>
    );
  }
  return (
    <>
      <WarningCircle size={16} />
      <span>Сеть ограничена</span>
    </>
  );
}

function useDesktopNetwork() {
  const [network, setNetwork] = useState<NetworkEnvironmentStatus | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatusReport | null>(null);
  const [desktop, setDesktop] = useState<DesktopInfo | null>(null);
  const [loading, setLoading] = useState(false);

  async function checkNetwork() {
    setLoading(true);
    try {
      const [netRes, tunRes, deskRes] = await Promise.all([
        probeNetworkStatus(),
        getTunnelStatus(),
        getDesktopInfo(),
      ]);
      setNetwork(netRes);
      setTunnel(tunRes);
      setDesktop(deskRes);
    } catch {
      // Degrades gracefully on transient probe failure
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void checkNetwork();
    const interval = setInterval(() => {
      void checkNetwork();
    }, 90_000);
    return () => clearInterval(interval);
  }, []);

  return { network, tunnel, desktop, loading, checkNetwork };
}

export function DesktopNetworkIndicator() {
  const { network, tunnel, desktop, loading, checkNetwork } = useDesktopNetwork();

  const isDirect = network?.recommendation === 'direct';
  const isTunnelActive =
    network?.recommendation === 'tunnel_required' || tunnel?.state === 'running';
  const stateClass = isDirect ? 'is-direct' : isTunnelActive ? 'is-tunnel-active' : 'is-limited';

  return (
    <div
      className={`career-desktop-network-indicator ${stateClass}`}
      role="region"
      aria-label="Сетевой маршрут и защита аккаунтов"
    >
      <IndicatorLabel loading={loading} isDirect={isDirect} isTunnelActive={isTunnelActive} />

      {desktop?.is_desktop_companion ? (
        <span className="career-desktop-tag">
          {desktop.os} {desktop.arch}
        </span>
      ) : null}

      <button
        type="button"
        className="career-desktop-refresh-btn"
        onClick={() => void checkNetwork()}
        disabled={loading}
        title="Перепроверить доступность LinkedIn и статус туннеля"
        aria-label="Перепроверить сеть"
      >
        <ArrowsClockwise size={13} />
      </button>
    </div>
  );
}
