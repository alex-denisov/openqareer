import { useEffect, useState } from 'react';

import { getConnections } from '../coach/coachApi';
import {
  linkedinImportProgressView,
  useLinkedInImportProgress,
} from '../connections/linkedinImportProgress';
import {
  connectorPresence,
  linkedinStaleLabel,
  partialSourcesMessage,
  type ConnectorPresence,
} from './firstRunSpecialState';
import { useLongWait } from './useLongWait';

export interface FirstRunSpecialView {
  /** «LinkedIn подключён, hh.ru нет…» — только по ответу сервера. */
  readonly partialMessage: string | null;
  /** «Читаем LinkedIn: раздел 2 из 5» — когда чтение идёт дольше обычного. */
  readonly importLabel: string | null;
}

function useConnectorPresence(candidateId: string | null): ConnectorPresence | null {
  const [presence, setPresence] = useState<ConnectorPresence | null>(null);
  useEffect(() => {
    setPresence(null);
    if (!candidateId) return;
    let current = true;
    getConnections()
      .then((connections) => {
        if (current) setPresence(connectorPresence(connections));
      })
      // Нет ответа — нет заметки: о подключениях не говорим наугад.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [candidateId]);
  return presence;
}

export function useFirstRunSpecialState(candidateId: string | null): FirstRunSpecialView {
  const presence = useConnectorPresence(candidateId);
  const progress = linkedinImportProgressView(useLinkedInImportProgress());
  const importIsLong = useLongWait(progress !== null);
  return {
    partialMessage: partialSourcesMessage(presence),
    importLabel: importIsLong ? linkedinStaleLabel(progress) : null,
  };
}
