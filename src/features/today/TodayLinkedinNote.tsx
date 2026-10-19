import { useEffect, useState } from 'react';
import { Info, LinkedinLogo } from '@phosphor-icons/react';
import { getConnections, type CandidateConnection } from '../coach/coachApi';

const LINKEDIN_LATER = 'Постов и контактов LinkedIn пока нет: доступно после подключения.';

function isLinked(connection: CandidateConnection | undefined): boolean {
  return connection?.status === 'connected' || connection?.status === 'imported';
}

/** Текст макета 1; «по hh.ru» — только если hh.ru и правда подключён. */
export function todayLinkedinNoteCopy(connections: readonly CandidateConnection[]): string | null {
  const find = (platform: CandidateConnection['platform']) =>
    connections.find((item) => item.platform === platform);
  if (isLinked(find('linkedin'))) return null;
  return isLinked(find('hh')) ? `Очередь собрана по hh.ru. ${LINKEDIN_LATER}` : LINKEDIN_LATER;
}

function useConnectionsOnce(): readonly CandidateConnection[] | null {
  const [connections, setConnections] = useState<readonly CandidateConnection[] | null>(null);
  useEffect(() => {
    let active = true;
    void getConnections()
      .then((loaded) => {
        if (active) setConnections(loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return connections;
}

/** Макет 1 «Частично: LinkedIn не подключён». */
export function TodayLinkedinNote({
  queueSize,
  onOpenConnections,
}: {
  readonly queueSize: number;
  readonly onOpenConnections?: () => void;
}) {
  const connections = useConnectionsOnce();
  const copy = connections && queueSize > 0 ? todayLinkedinNoteCopy(connections) : null;
  if (!copy) return null;
  return (
    <div className="today-linkedin-note">
      <p>
        <Info size={16} aria-hidden="true" />
        <span>{copy}</span>
      </p>
      {onOpenConnections ? (
        <button type="button" className="career-quiet-button" onClick={onOpenConnections}>
          <LinkedinLogo size={16} aria-hidden="true" />
          Подключить LinkedIn
        </button>
      ) : null}
    </div>
  );
}
