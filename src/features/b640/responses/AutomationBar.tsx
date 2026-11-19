import { useCallback, useId, useState } from 'react';
import {
  disableCandidateAutomation,
  enableCandidateAutomation,
  getCandidateAutomation,
  resumeCandidateAutomation,
  type CandidateAutomationSnapshot,
} from '../../automation/automationApi';
import { apiErrorMessage } from '../../coach/apiClient';
import { fetchTariffQuotas, type TariffQuotaSummary } from '../../tariffs/tariffQuotaApi';
import { Icon, StatusLine, useToast } from '../kit';
import { AutomationSheet } from './AutomationSheet';
import { useAsync } from './data/useAsync';
import { buildAutomationView, type AutomationView } from './model/automationView';

interface AutomationData {
  readonly snapshot: CandidateAutomationSnapshot;
  readonly quotas: TariffQuotaSummary | null;
}

async function loadAutomation(): Promise<AutomationData> {
  const [snapshot, quotas] = await Promise.all([
    getCandidateAutomation(),
    fetchTariffQuotas().catch(() => null),
  ]);
  return { snapshot, quotas };
}

interface SwitchState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly switchTo: (on: boolean) => void;
}

function useAutomationSwitch(
  snapshot: CandidateAutomationSnapshot | null,
  consentKeys: readonly string[],
  reload: () => void,
): SwitchState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(on: boolean) {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      if (!on) await disableCandidateAutomation();
      else if (snapshot.settings.enabled) await resumeCandidateAutomation();
      else await enableCandidateAutomation({ mode: snapshot.settings.mode, consentKeys });
      reload();
    } catch (reason: unknown) {
      setError(apiErrorMessage(reason, 'Не получилось переключить автоотклики.'));
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, switchTo: (on) => void apply(on) };
}

interface BarRowProps {
  readonly id: string;
  readonly view: AutomationView;
  readonly toggle: SwitchState;
  readonly onSetup: () => void;
}

function BarRow({ id, view, toggle, onSetup }: BarRowProps) {
  return (
    <div className="ot-auto" role="group" aria-label="Автоотклики">
      <label className="ot-auto-sw" htmlFor={`${id}-on`}>
        <input
          className="sw"
          id={`${id}-on`}
          type="checkbox"
          role="switch"
          checked={view.on}
          disabled={toggle.busy}
          onChange={(event) => {
            const on = event.currentTarget.checked;
            if (on && !view.consented) onSetup();
            else toggle.switchTo(on);
          }}
        />
        Автоотклики
      </label>
      {view.on ? (
        <span className="ot-auto-n num">{`${view.sentToday} сегодня из ${view.dayLimit}`}</span>
      ) : null}
      <button className="btn is-sm ot-auto-b" type="button" onClick={onSetup}>
        <Icon name="sliders" />
        Настроить
      </button>
    </div>
  );
}

/**
 * Строка «Автоотклики» над списком (O1): переключатель, счётчик дня и «Настроить».
 * Не загрузилась — строки нет, список работает без неё. Согласий ещё нет — включение открывает
 * лист настроек с отметкой согласия (B645).
 */
export function AutomationBar() {
  const id = useId();
  const toast = useToast();
  const load = useCallback(() => loadAutomation(), []);
  const { state, reload } = useAsync(load, 'Автоотклики не загрузились.');
  const [sheet, setSheet] = useState(false);
  const snapshot = state.data?.snapshot ?? null;
  const view = snapshot ? buildAutomationView(snapshot, state.data?.quotas ?? null) : null;
  const toggle = useAutomationSwitch(snapshot, view?.consentKeys ?? [], reload);
  const saved = () => {
    setSheet(false);
    toast.show({ text: 'Настройки автооткликов сохранены' });
    reload();
  };
  if (!snapshot || !view?.visible) return null;

  return (
    <>
      <BarRow id={id} view={view} toggle={toggle} onSetup={() => setSheet(true)} />
      {toggle.error ? <StatusLine state="err" text={toggle.error} /> : null}
      {sheet ? (
        <AutomationSheet
          open
          snapshot={snapshot}
          view={view}
          onClose={() => setSheet(false)}
          onFailed={reload}
          onSaved={saved}
        />
      ) : null}
    </>
  );
}
