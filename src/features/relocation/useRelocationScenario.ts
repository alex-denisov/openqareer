import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import {
  calculateRelocationScenario,
  relocationScenarioInputSchema,
  type RelocationCost,
  type RelocationScenarioInput,
  type RelocationScenarioResult,
  type SavedRelocationScenario,
} from '../../../shared/relocationScenario';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { relocationVisaProfile } from '../../../shared/relocationVisaProfile';
import {
  deleteRelocationScenario,
  listRelocationScenarios,
  saveRelocationScenario,
} from './relocationScenarioApi';
import {
  scenarioFamilyFromProfile,
  scenarioHouseholdSize,
  scenarioPayrollOptions,
  type ScenarioFamily,
} from './relocationScenarioFamily';

type Input = RelocationScenarioInput;

/** Everything the person types in the editor; country and salary come from the calculation screen. */
export interface ScenarioDraft {
  readonly name: string;
  readonly city: string;
  readonly family: ScenarioFamily;
  readonly incomeMode: Input['incomeMode'];
  readonly scenarioId: Input['scenarioId'];
  readonly expenses: Input['expenses'];
  readonly upfront: Input['upfront'];
  readonly proofOfFunds?: RelocationCost;
  readonly proofFundsUsableForLiving: boolean;
  readonly confirmedNetMonthly?: RelocationCost;
  readonly comparisonRate?: RelocationCost;
  readonly reserveMonths: number;
  readonly visa: Input['visa'];
  readonly payrollOptions: NonNullable<Input['payrollOptions']>;
}

export interface ScenarioContext {
  readonly countryCode: string;
  readonly income: number | undefined;
  readonly profile: RelocationQuestionnaire | null;
}

export function emptyScenarioDraft(profile: RelocationQuestionnaire | null): ScenarioDraft {
  return {
    name: 'Мой сценарий',
    city: '',
    family: scenarioFamilyFromProfile(profile),
    incomeMode: 'local_employment',
    scenarioId: 'employer_sponsorship',
    expenses: {},
    upfront: {},
    proofFundsUsableForLiving: false,
    reserveMonths: 3,
    visa: relocationScenarioInputSchema.shape.visa.parse(relocationVisaProfile(profile)),
    payrollOptions: {},
  };
}

/** The validated API input; the family fills the household size and the visa family facts. */
export function scenarioInput(draft: ScenarioDraft, context: ScenarioContext): Input {
  return relocationScenarioInputSchema.parse({
    name: draft.name,
    city: draft.city,
    householdSize: scenarioHouseholdSize(draft.family),
    countryCode: context.countryCode,
    grossAnnualIncome: context.income,
    incomeMode: draft.incomeMode,
    scenarioId: draft.scenarioId,
    expenses: draft.expenses,
    upfront: draft.upfront,
    reserveMonths: draft.reserveMonths,
    proofOfFunds: draft.proofOfFunds,
    proofFundsUsableForLiving: draft.proofFundsUsableForLiving,
    confirmedNetMonthly:
      draft.incomeMode === 'local_employment' ? undefined : draft.confirmedNetMonthly,
    comparisonRate: draft.comparisonRate,
    payrollOptions: scenarioPayrollOptions(context.countryCode, draft.family, draft.payrollOptions),
    visa: { ...draft.visa, family: draft.family },
  });
}

function draftFromSaved(saved: SavedRelocationScenario): ScenarioDraft {
  const s = saved.input;
  return {
    name: s.name,
    city: s.city,
    family: s.visa.family ?? { hasPartner: false, children: Math.max(0, s.householdSize - 1) },
    incomeMode: s.incomeMode,
    scenarioId: s.scenarioId,
    expenses: s.expenses,
    upfront: s.upfront,
    proofOfFunds: s.proofOfFunds,
    proofFundsUsableForLiving: s.proofFundsUsableForLiving,
    confirmedNetMonthly: s.confirmedNetMonthly,
    comparisonRate: s.comparisonRate,
    reserveMonths: s.reserveMonths,
    visa: s.visa,
    payrollOptions: s.payrollOptions ?? {},
  };
}

const INPUT_ERROR =
  'Проверьте город, суммы, валюты и даты. Пустой расход остаётся неизвестным, 0 — проверенное отсутствие расхода.';

function useSavedScenarios(onError: (message: string) => void) {
  const [items, setItems] = useState<readonly SavedRelocationScenario[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const mounted = useRef(true);
  const load = async (offset = 0) => {
    try {
      const page = await listRelocationScenarios(offset);
      if (!mounted.current) return;
      setItems((old) => (offset ? [...old, ...page.items] : page.items));
      setNextOffset(page.nextOffset);
    } catch (reason) {
      if (mounted.current)
        onError(apiErrorMessage(reason, 'Не удалось загрузить сохранённые расчёты.'));
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
    // The list loads once; later loads follow saves and deletions.
  }, []);
  return { items, nextOffset, load, mounted };
}

interface Status {
  readonly setError: (message: string) => void;
  readonly setNotice: (message: string) => void;
  readonly setBusy: (busy: boolean) => void;
}

/** Validates the draft, saves it once per body (a retry reuses the idempotency key) and reloads the list. */
function usePersist(
  draft: ScenarioDraft,
  context: ScenarioContext,
  status: Status,
  saved: ReturnType<typeof useSavedScenarios>,
) {
  const retry = useRef<{ body: string; key: string }>();
  const persist = async (): Promise<SavedRelocationScenario | null> => {
    status.setError('');
    status.setNotice('');
    let input: Input;
    try {
      input = scenarioInput(draft, context);
      calculateRelocationScenario(input, context.profile);
    } catch {
      status.setError(INPUT_ERROR);
      return null;
    }
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    status.setBusy(true);
    try {
      const stored = await saveRelocationScenario(input, retry.current.key);
      await saved.load();
      return stored;
    } catch (reason) {
      status.setError(
        apiErrorMessage(
          reason,
          'Не удалось сохранить. Повторите: повторный запрос не создаст дубликат.',
        ),
      );
      return null;
    } finally {
      if (saved.mounted.current) status.setBusy(false);
    }
  };
  return { persist, forget: () => (retry.current = undefined) };
}

/**
 * The scenario editor of «Экономика»: «Сбросить» clears what the person typed, «Сохранить» adds
 * the scenario to «Сохранённые расчёты» and keeps editing, «Рассчитать» saves it too and returns
 * the result for the calculation screen.
 */
export function useRelocationScenario(context: ScenarioContext) {
  const [draft, setDraft] = useState<ScenarioDraft>(() => emptyScenarioDraft(context.profile));
  const [calculated, setCalculated] = useState<SavedRelocationScenario>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const saved = useSavedScenarios(setError);
  const status = { setError, setNotice, setBusy };
  const { persist, forget } = usePersist(draft, context, status, saved);
  const actions = scenarioActions({
    context,
    setDraft,
    setCalculated,
    persist,
    forget,
    status,
    saved,
  });
  return {
    draft,
    update: (patch: Partial<ScenarioDraft>) => setDraft((current) => ({ ...current, ...patch })),
    /** The last scenario «Рассчитать» saved or the person opened: what the calculation screen shows. */
    calculated,
    busy,
    error,
    notice,
    saved: saved.items,
    nextOffset: saved.nextOffset,
    loadMore: () => (saved.nextOffset === null ? undefined : void saved.load(saved.nextOffset)),
    ...actions,
  };
}

function scenarioActions({
  context,
  setDraft,
  setCalculated,
  persist,
  forget,
  status,
  saved,
}: {
  readonly context: ScenarioContext;
  readonly setDraft: (draft: ScenarioDraft) => void;
  readonly setCalculated: (scenario: SavedRelocationScenario | undefined) => void;
  readonly persist: () => Promise<SavedRelocationScenario | null>;
  readonly forget: () => void;
  readonly status: Status;
  readonly saved: ReturnType<typeof useSavedScenarios>;
}) {
  return {
    reset: () => {
      setDraft(emptyScenarioDraft(context.profile));
      setCalculated(undefined);
      status.setError('');
      forget();
      status.setNotice('Поля сценария очищены. Страна и зарплата остались с экрана расчёта.');
    },
    save: async () => {
      if (await persist()) status.setNotice('Сценарий сохранён в «Сохранённые расчёты».');
    },
    calculate: async (): Promise<RelocationScenarioResult | null> => {
      const stored = await persist();
      if (!stored) return null;
      setCalculated(stored);
      return stored.result;
    },
    open: (item: SavedRelocationScenario) => {
      setDraft(draftFromSaved(item));
      setCalculated(item);
      forget();
      status.setNotice(
        `Открыт сохранённый сценарий «${item.input.name}». Новая версия сохранится отдельно.`,
      );
      return item.input;
    },
    remove: (id: string) => removeScenario(id, { forget, status, saved }),
  };
}

async function removeScenario(
  id: string,
  {
    forget,
    status,
    saved,
  }: {
    readonly forget: () => void;
    readonly status: Status;
    readonly saved: ReturnType<typeof useSavedScenarios>;
  },
) {
  status.setBusy(true);
  try {
    await deleteRelocationScenario(id);
    forget();
    await saved.load();
    status.setNotice('Расчёт удалён.');
  } catch (reason) {
    status.setError(apiErrorMessage(reason, 'Не удалось удалить расчёт.'));
  } finally {
    if (saved.mounted.current) status.setBusy(false);
  }
}

export type RelocationScenarioState = ReturnType<typeof useRelocationScenario>;
