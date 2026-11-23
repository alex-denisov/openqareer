import { useId, useState } from 'react';
import { COMMON_TIMEZONES, DEFAULT_ACCOUNT_TIMEZONE, formatTimezoneDisplay } from '../../../../shared/timezoneUtils';
import { getAccount, updateAccountProfile } from '../../coach/coachApi';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import { SegControl } from '../kit/SegControl';
import type { B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import type { B640Theme } from '../theme';
import type { AppMoneyCurrency } from '../../../../shared/b640AppPreferences';
import { DeviceSettingsSection, WebAppSection } from './DeviceSettingsSection';
import { getAppPreferences, saveAppPreferences } from './appPreferencesApi';
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

const CURRENCIES: ReadonlyArray<{ value: AppMoneyCurrency; label: string }> = [
  { value: 'RUB', label: '₽' },
  { value: 'USD', label: '$' },
  { value: 'EUR', label: '€' },
  { value: 'AED', label: 'AED' },
];

/** Тема меняется сразу на этом устройстве и запоминается за кандидатом для других. */
function ThemeRow() {
  const { theme, setTheme: applyTheme } = useShell();
  const setTheme = (next: B640Theme) => {
    applyTheme(next);
    void saveAppPreferences({ theme: next }).catch(() => undefined);
  };
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

/** Язык интерфейса один — русский: текстом, а не списком, где нечего выбрать (B774). */
function LanguageRow() {
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">Язык</span>
      </div>
      <div className="set-r">
        <span className="set-v">Русский</span>
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

/** B593: валюта, в которой «Вакансии» показывают суммы; сбой возвращает прежнюю. */
function CurrencyRow() {
  const load = useLoad(getAppPreferences);
  const [failed, setFailed] = useState(false);
  const current = load.state === 'ready' ? (load.data.moneyCurrency ?? 'RUB') : 'RUB';
  async function choose(moneyCurrency: AppMoneyCurrency) {
    if (load.state !== 'ready') return;
    const previous = load.data;
    setFailed(false);
    load.replace({ ...previous, moneyCurrency });
    try {
      await saveAppPreferences({ moneyCurrency });
    } catch {
      load.replace(previous);
      setFailed(true);
    }
  }
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">Валюта зарплат</span>
        {failed ? <ErrorLine text="Не сохранилось" /> : null}
        {load.state === 'error' ? <ErrorLine text="Не загрузилось" onRetry={load.retry} /> : null}
      </div>
      <div className="set-r">
        <SegControl label="Валюта зарплат" name="b640-money" variant="sec-seg" value={current} options={CURRENCIES} onChange={(value) => void choose(value)} />
      </div>
    </li>
  );
}

/** n06 «Приложение»: тема, язык, часовой пояс, валюта; в приложении — настройки этого компьютера, на сайте — версия и скачивание (B722). */
export function AppScreen({ node }: { readonly node: B640Node }) {
  return (
    <SettingsPage node={node} heading="Приложение">
      <section className="set-group" aria-label="Интерфейс">
        <h3 className="set-h">Интерфейс</h3>
        <ul className="set-list">
          <ThemeRow />
          <LanguageRow />
          <TimezoneRow />
          <CurrencyRow />
        </ul>
      </section>
      {isTauriEnvironment() ? <DeviceSettingsSection /> : <WebAppSection />}
    </SettingsPage>
  );
}
