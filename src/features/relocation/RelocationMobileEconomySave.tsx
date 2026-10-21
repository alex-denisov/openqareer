import { useEffect, useRef, useState } from 'react';
import { FloppyDisk } from '@phosphor-icons/react';
import { apiErrorMessage } from '../coach/apiClient';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import {
  relocationScenarioInputSchema,
  type RelocationScenarioInput,
  type SavedRelocationScenario,
} from '../../../shared/relocationScenario';
import { relocationVisaProfile } from '../../../shared/relocationVisaProfile';
import { getCountryMobilityData } from '../../../shared/countryFit';
import { listRelocationScenarios, saveRelocationScenario } from './relocationScenarioApi';
import { MobileGroup, MobileInputRow } from './mobile/MobileRows';
import { relocationDay } from './relocationDates';

export interface RelocationMobileEconomySaveProps {
  readonly countryCode: string;
  readonly grossAnnualIncome: number | undefined;
  readonly profile: RelocationQuestionnaire | null;
}

/** The same defaults as the desktop scenario panel; costs stay unknown until entered there. */
function mobileScenarioInput(
  props: RelocationMobileEconomySaveProps,
  city: string,
): RelocationScenarioInput | null {
  const parsed = relocationScenarioInputSchema.safeParse({
    name: `${getCountryMobilityData(props.countryCode).name}, ${city.trim()}`,
    city,
    householdSize: 1,
    countryCode: props.countryCode,
    grossAnnualIncome: props.grossAnnualIncome,
    incomeMode: 'local_employment',
    scenarioId: 'employer_sponsorship',
    expenses: {},
    upfront: {},
    reserveMonths: 3,
    visa: relocationVisaProfile(props.profile),
  });
  return parsed.success ? parsed.data : null;
}

function useSavedScenarios() {
  const [items, setItems] = useState<readonly SavedRelocationScenario[]>([]);
  const [error, setError] = useState('');
  const refresh = async () => {
    try {
      setItems((await listRelocationScenarios()).items);
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось загрузить сохранённые расчёты.'));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  return { items, error, setError, refresh };
}

function useMobileSave(input: RelocationScenarioInput | null) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const saved = useSavedScenarios();
  const retry = useRef<{ body: string; key: string }>();
  const save = async () => {
    if (!input || busy) return;
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setNotice('');
    saved.setError('');
    try {
      await saveRelocationScenario(input, retry.current.key);
      setNotice('Расчёт сохранён в профиле.');
      await saved.refresh();
    } catch (reason) {
      saved.setError(
        apiErrorMessage(
          reason,
          'Не удалось сохранить. Повторите: повторный запрос не создаст дубликат.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return { busy, notice, saved, save };
}

function SavedList({ items }: { readonly items: readonly SavedRelocationScenario[] }) {
  if (!items.length) return null;
  return (
    <MobileGroup caption="Сохранённые расчёты">
      {items.slice(0, 5).map((item) => (
        <div key={item.id} className="vacancy-push-kv">
          <span>{item.input.name}</span>
          <span>{relocationDay(item.createdAt)}</span>
        </div>
      ))}
    </MobileGroup>
  );
}

/** Mockup 15 `vt=net` at 390: «Сохранить расчёт в профиль» under the split. */
export function RelocationMobileEconomySave(props: RelocationMobileEconomySaveProps) {
  const [city, setCity] = useState('');
  const input = mobileScenarioInput(props, city);
  const { busy, notice, saved, save } = useMobileSave(input);
  return (
    <>
      <MobileGroup
        note={
          input ? undefined : 'Для сохранения нужны страна с налоговой шкалой, зарплата и город.'
        }
      >
        <MobileInputRow
          id="relocation-mobile-economy-city"
          label="Город расчёта"
          value={city}
          onChange={setCity}
        />
      </MobileGroup>
      <div className="career-relocation-mobile-save">
        <button
          className="career-btn career-btn-secondary"
          type="button"
          disabled={!input || busy}
          aria-busy={busy}
          onClick={() => void save()}
        >
          <FloppyDisk aria-hidden="true" size={18} />
          {busy ? 'Сохраняем…' : 'Сохранить расчёт в профиль'}
        </button>
      </div>
      {notice ? (
        <p className="career-relocation-success" role="status">
          {notice}
        </p>
      ) : null}
      {saved.error ? (
        <p className="career-relocation-error" role="alert">
          {saved.error}
        </p>
      ) : null}
      <SavedList items={saved.items} />
    </>
  );
}
