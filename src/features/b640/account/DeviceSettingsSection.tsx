import { useId, useState } from 'react';
import { desktopUpdater } from '../../appUpdate/useDesktopUpdater';
import { Switch } from '../kit/Settings';
import { DESKTOP_DOWNLOAD_PATH } from '../../site/DesktopDownload';
import { appBuildLine } from './appBuild';
import { AppVersionRow } from './AppVersionRow';
import { getDeviceSettings, saveDeviceSettings, type DeviceSettings } from './deviceSettingsApi';
import { ErrorLine, useLoad, type Load } from './parts';

type SettingKey = keyof DeviceSettings;

/** macOS называет место значка строкой меню, Windows — областью уведомлений. */
export function trayIconTitle(userAgent: string): string {
  return /Mac/u.test(userAgent) ? 'Значок в строке меню' : 'Значок в области уведомлений';
}

interface SwitchRowProps {
  readonly title: string;
  readonly field: SettingKey;
  readonly load: Load<DeviceSettings>;
  readonly onSaved?: (settings: DeviceSettings) => void;
}

/** Переключатель сохраняется сразу; сбой возвращает прежнее положение и говорит об этом на месте. */
function SwitchRow({ title, field, load, onSaved }: SwitchRowProps) {
  const labelId = useId();
  const [failed, setFailed] = useState(false);
  const ready = load.state === 'ready';
  async function toggle(checked: boolean) {
    if (load.state !== 'ready') return;
    const previous = load.data;
    setFailed(false);
    load.replace({ ...previous, [field]: checked });
    try {
      const saved = await saveDeviceSettings({ [field]: checked });
      load.replace(saved);
      onSaved?.(saved);
    } catch {
      load.replace(previous);
      setFailed(true);
    }
  }
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t" id={labelId}>
          {title}
        </span>
        {failed ? <ErrorLine text="Не сохранилось" /> : null}
      </div>
      <div className="set-r">
        <Switch
          labelledBy={labelId}
          checked={ready ? load.data[field] : false}
          disabled={!ready}
          onChange={(value) => void toggle(value)}
        />
      </div>
    </li>
  );
}

/** На сайте — сборка сайта; в приложении строку ведёт `AppVersionRow`. */
const VERSION_LINE = appBuildLine(__APP_VERSION__, __APP_COMMIT__, __APP_BUILD_DATE__);

/** n06 в приложении: «Обновления» и «Работа приложения» — настройки этого компьютера (B722). */
export function DeviceSettingsSection() {
  const load = useLoad(getDeviceSettings);
  return (
    <div className="only-desk">
      <div className="sec-grp">
        <section className="set-group" aria-label="Обновления">
          <h3 className="set-h">Обновления</h3>
          <ul className="set-list">
            <AppVersionRow />
            <SwitchRow
              title="Обновлять автоматически"
              field="autoUpdate"
              load={load}
              onSaved={(settings) => desktopUpdater.setAutoInstall(settings.autoUpdate)}
            />
          </ul>
        </section>
        <section className="set-group" aria-label="Работа приложения">
          <h3 className="set-h">Работа приложения</h3>
          {load.state === 'error' ? <ErrorLine text="Не загрузилось" onRetry={load.retry} /> : null}
          <ul className="set-list">
            <SwitchRow title={trayIconTitle(navigator.userAgent)} field="trayIcon" load={load} />
            <SwitchRow title="Запуск при входе в систему" field="launchAtLogin" load={load} />
          </ul>
        </section>
      </div>
    </div>
  );
}

/** n06 на сайте (решение владельца 19.11): версия и одна строка со скачиванием приложения, как в подвале сайта. */
export function WebAppSection() {
  return (
    <div className="only-desk">
      <div className="sec-grp">
        <section className="set-group" aria-label="Обновления">
          <h3 className="set-h">Обновления</h3>
          <ul className="set-list">
            <li className="set-row">
              <div className="set-l">
                <span className="set-t">{VERSION_LINE}</span>
              </div>
            </li>
            <li className="set-row">
              <div className="set-l">
                <span className="set-t">Приложение для Mac</span>
              </div>
              <div className="set-r">
                <a className="btn is-sm" href={DESKTOP_DOWNLOAD_PATH} download>
                  Скачать
                </a>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
