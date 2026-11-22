import { useId, useState } from 'react';
import { InfoTip } from '../kit/InfoTip';
import { SegControl, type SegOption } from '../kit/SegControl';
import { Switch } from '../kit/Settings';
import {
  getDeliverySettings,
  putDeliverySettings,
  type DeliveryFrequency,
  type DeliverySettings,
} from './deliverySettingsApi';
import { ErrorLine, useLoad } from './parts';

const FREQUENCIES: readonly SegOption<DeliveryFrequency>[] = [
  { value: 'immediate', label: 'Сразу' },
  { value: 'daily', label: 'Раз в день' },
  { value: 'weekly', label: 'Раз в неделю' },
];

/** Подсказка называет только каналы, которые есть: без Telegram на проде его в тексте нет. */
function hideHint(telegram: boolean): string {
  return telegram
    ? 'На заблокированном экране, в письме и в Telegram будет «Ответ работодателя».'
    : 'На заблокированном экране и в письме будет «Ответ работодателя».';
}

/** Значение меняется сразу; сбой сохранения возвращает прежнее и показан на месте. */
function useSave(settings: DeliverySettings, replace: (value: DeliverySettings) => void) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  async function save(next: DeliverySettings) {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    replace(next);
    try {
      replace(await putDeliverySettings(next));
    } catch {
      replace(settings);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  return { saving, failed, save };
}

function DeliveryRows({
  settings,
  replace,
  telegram,
}: {
  readonly settings: DeliverySettings;
  readonly replace: (value: DeliverySettings) => void;
  readonly telegram: boolean;
}) {
  const hideId = useId();
  const { saving, failed, save } = useSave(settings, replace);
  return (
    <>
      {failed ? <ErrorLine text="Настройка не сохранилась" /> : null}
      <ul className="set-list">
        <li className="set-row is-stack">
          <div className="set-l">
            <span className="set-t">Как часто</span>
          </div>
          <div className="set-r">
            <SegControl
              label="Как часто"
              name="delivery-frequency"
              variant="sec-seg"
              value={settings.frequency}
              options={FREQUENCIES}
              onChange={(frequency) => void save({ ...settings, frequency })}
            />
          </div>
        </li>
        <li className="set-row">
          <div className="set-l">
            <span className="set-t" id={hideId}>
              Не показывать название компании{' '}
              <InfoTip label="Что увидят вместо названия" text={hideHint(telegram)} />
            </span>
          </div>
          <div className="set-r">
            <Switch
              labelledBy={hideId}
              checked={settings.hideCompany}
              disabled={saving}
              onChange={(hideCompany) => void save({ ...settings, hideCompany })}
            />
          </div>
        </li>
      </ul>
    </>
  );
}

/** n02: «Как часто» и «Не показывать название компании» под таблицей событий. */
export function DeliverySettingsGroup({ telegram }: { readonly telegram: boolean }) {
  const load = useLoad(getDeliverySettings);
  return (
    <section className="set-group" aria-label="Как присылать">
      {load.state === 'error' ? <ErrorLine text="Настройки не загрузились" onRetry={load.retry} /> : null}
      {load.state === 'ready' ? <DeliveryRows settings={load.data} replace={load.replace} telegram={telegram} /> : null}
    </section>
  );
}
