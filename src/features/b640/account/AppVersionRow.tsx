import { useEffect, useState, useSyncExternalStore } from 'react';
import { installedAppVersion } from '../../appUpdate/appUpdateBridge';
import type { AppUpdateStatusData } from '../../appUpdate/appUpdateTypes';
import { desktopUpdater, type CheckOutcome } from '../../appUpdate/useDesktopUpdater';
import { ResultLine, StatusLine } from '../kit/ResultLine';
import { appBuildLine } from './appBuild';
import { ErrorLine } from './parts';

/** Версия, которую на самом деле запускает .app; до ответа — версия сборки фронтенда. */
function useInstalledVersion(): string {
  const [version, setVersion] = useState(__APP_VERSION__);
  useEffect(() => {
    let active = true;
    installedAppVersion().then(
      (value) => active && value && setVersion(value),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  return version;
}

interface UpdateLineProps {
  readonly status: AppUpdateStatusData;
  readonly outcome: CheckOutcome | null;
  readonly onCheck: () => void;
}

/** Что сейчас с обновлением: найдено, загружается, ждёт перезапуска, сбой — или итог проверки. */
function UpdateLine({ status, outcome, onCheck }: UpdateLineProps) {
  const { actions } = desktopUpdater;
  const next = status.info.version;
  if (status.state === 'available') {
    return (
      <StatusLine
        state="ok"
        text={`Есть версия ${next}`}
        action={
          <button className="res-act" type="button" onClick={actions.onInstall}>
            Обновить
          </button>
        }
      />
    );
  }
  if (status.state === 'downloading') {
    return (
      <StatusLine
        state="wait"
        text={`Загружаем версию ${next} · ${status.info.progressPercent ?? 0} %`}
      />
    );
  }
  if (status.state === 'ready') {
    return (
      <StatusLine
        state="ok"
        text={`Версия ${next} установится при перезапуске`}
        action={
          <button className="res-act" type="button" onClick={actions.onRestart}>
            Перезапустить
          </button>
        }
      />
    );
  }
  if (status.state === 'error') {
    return (
      <ErrorLine
        text={status.errorMessage ?? 'Обновление не установилось'}
        onRetry={actions.onRetryNow}
      />
    );
  }
  if (outcome === 'failed')
    return <ErrorLine text="Не удалось проверить обновления" onRetry={onCheck} />;
  if (outcome === 'latest') return <ResultLine text="У вас последняя версия" />;
  return null;
}

/** n06 в приложении: настоящая версия и правда об обновлении (B771). */
export function AppVersionRow() {
  const version = useInstalledVersion();
  const status = useSyncExternalStore(
    desktopUpdater.subscribe,
    desktopUpdater.getStatus,
    desktopUpdater.getStatus,
  );
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  async function check() {
    setBusy(true);
    setOutcome(await desktopUpdater.check());
    setBusy(false);
  }
  const idle = status.state === 'idle';
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">{appBuildLine(version, __APP_COMMIT__, __APP_BUILD_DATE__)}</span>
        <UpdateLine status={status} outcome={outcome} onCheck={() => void check()} />
      </div>
      {idle ? (
        <div className="set-r">
          <button
            className="btn is-sm"
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void check()}
          >
            Проверить обновления
          </button>
        </div>
      ) : null}
    </li>
  );
}
