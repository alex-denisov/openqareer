import { useId, useState } from 'react';
import { COMMON_TIMEZONES, DEFAULT_ACCOUNT_TIMEZONE, formatTimezoneDisplay } from '../../../../shared/timezoneUtils';
import { desktopUpdater } from '../../appUpdate/useDesktopUpdater';
import { getAccount, updateAccountProfile } from '../../coach/coachApi';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import { ResultLine } from '../kit/ResultLine';
import { SegControl } from '../kit/SegControl';
import type { B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import type { B640Theme } from '../theme';
import { appBuildLine } from './appBuild';
import { ErrorLine, SettingsPage, useLoad } from './parts';

const THEMES: ReadonlyArray<{ value: B640Theme; label: string }> = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

async function loadTimezone(): Promise<string> {
  const account = await getAccount();
  return account.profile.timezone ?? DEFAULT_ACCOUNT_TIMEZONE;
}

function ThemeRow() {
  const { theme, setTheme } = useShell();
  return (
    <li className="set-row is-stack">
      <div className="set-l">
        <span className="set-t">Тема</span>
      </div>
      <div className="set-r">
        <SegControl label="Тема" name="b640-theme" variant="sec-seg" value={theme} options={THEMES} onChange={setTheme} />
      </div>
    </li>
  );
}

/** Часовой пояс сохраняется сразу по выбору; сбой возвращает прежнее значение. */
function TimezoneRow() {
  const labelId = useId();
  const load = useLoad(loadTimezone);
  const [failed, setFailed] = useState(false);
  const current = load.state === 'ready' ? load.data : DEFAULT_ACCOUNT_TIMEZONE;
  const zones = COMMON_TIMEZONES.some((item) => item.timezone === current)
    ? COMMON_TIMEZONES
    : [{ city: current, timezone: current }, ...COMMON_TIMEZONES];
  async function choose(timezone: string) {
    setFailed(false);
    load.replace(timezone);
    try {
      await updateAccountProfile({ timezone });
    } catch {
      load.replace(current);
      setFailed(true);
    }
  }
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t" id={labelId}>
          Часовой пояс
        </span>
        {failed ? <ErrorLine text="Не сохранилось" /> : null}
        {load.state === 'error' ? <ErrorLine text="Не загрузилось" onRetry={load.retry} /> : null}
      </div>
      <div className="set-r">
        <select
          className="sec-sel"
          aria-labelledby={labelId}
          value={current}
          disabled={load.state !== 'ready'}
          onChange={(event) => void choose(event.target.value)}
        >
          {zones.map((zone) => (
            <option key={zone.timezone} value={zone.timezone}>
              {formatTimezoneDisplay(zone.timezone)}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}

type CheckResult = 'latest' | 'available' | null;

/** «Обновления» — только в приложении: версия и проверка с результатом на месте. */
function Updates() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult>(null);
  async function check() {
    setBusy(true);
    await desktopUpdater.check();
    setResult(desktopUpdater.getStatus().state === 'available' ? 'available' : 'latest');
    setBusy(false);
  }
  return (
    <div className="only-desk sec-grp">
      <section className="set-group" aria-label="Обновления">
        <h3 className="set-h">Обновления</h3>
        <ul className="set-list">
          <li className="set-row">
            <div className="set-l">
              <span className="set-t">{appBuildLine(__APP_VERSION__, __APP_COMMIT__, __APP_BUILD_DATE__)}</span>
              {result ? (
                <ResultLine text={result === 'available' ? 'Есть новая версия' : 'У вас последняя версия'} />
              ) : null}
            </div>
            <div className="set-r">
              <button className="btn is-sm" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void check()}>
                Проверить обновления
              </button>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}

/** n06 «Приложение»: тема, часовой пояс; в приложении — обновления. */
export function AppScreen({ node }: { readonly node: B640Node }) {
  return (
    <SettingsPage node={node} heading="Приложение">
      <section className="set-group" aria-label="Интерфейс">
        <h3 className="set-h">Интерфейс</h3>
        <ul className="set-list">
          <ThemeRow />
          <TimezoneRow />
        </ul>
      </section>
      {isTauriEnvironment() ? <Updates /> : null}
    </SettingsPage>
  );
}
