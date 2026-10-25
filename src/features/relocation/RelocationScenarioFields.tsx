import {
  RELOCATION_EXPENSES,
  RELOCATION_UPFRONT,
  type RelocationScenarioInput,
} from '../../../shared/relocationScenario';
import { relocationHousingReferences } from '../../../shared/relocationReferences';
import { EXPENSE_LABELS, ScenarioCostField, UPFRONT_LABELS } from './RelocationScenarioCosts';
import { RelocationVisaExtras, VisaCitizenships } from './RelocationVisaExtras';
import {
  RELOCATION_CITIES,
  RELOCATION_CURRENCIES,
  scenarioHouseholdSize,
} from './relocationScenarioFamily';
import type { ScenarioDraft } from './useRelocationScenario';

type Update = (patch: Partial<ScenarioDraft>) => void;
interface FieldsProps {
  readonly draft: ScenarioDraft;
  readonly update: Update;
  readonly countryCode: RelocationScenarioInput['countryCode'];
  readonly currency: string;
}

const INCOME_MODES: readonly (readonly [RelocationScenarioInput['incomeMode'], string])[] = [
  ['local_employment', 'Зарплата у местного работодателя'],
  ['remote_employment', 'Иностранная удалённая работа'],
  ['self_employed', 'Самозанятость или бизнес'],
];

const SCENARIOS: Readonly<Record<RelocationScenarioInput['scenarioId'], string>> = {
  domestic_market: 'Домашний рынок',
  employer_sponsorship: 'Работа со спонсорством',
  job_seeker_visa: 'Поиск работы на месте',
  digital_nomad: 'Digital Nomad',
  simple_mobility: 'Упрощённая мобильность',
};

const VISA_FLAGS = {
  hasJobOffer: 'Есть предложение о работе',
  approvedEmployerSponsor: 'Работодатель подтвердил спонсорство',
  occupationEligible: 'Профессия подходит выбранному маршруту',
  occupationGoingRateMet: 'Отраслевой порог зарплаты выполнен',
  completedFormalQualification: 'Профессиональная квалификация подтверждена',
  hasBachelorDegree: 'Есть диплом бакалавра',
  isItProfessional: 'IT-специалист',
  blueCardExceptionEligible: 'Есть основание для сниженного порога Blue Card',
  worksRemotelyForForeignEmployer: 'Работаю удалённо на иностранного работодателя',
  hasPrivateHealthInsurance: 'Есть подходящая медицинская страховка',
  remoteMonthlyIncomeIsNet: 'Удалённый доход указан после налогов',
} as const;

/** Name, city from the country's list, income type, reserve. */
export function ScenarioBasics({ draft, update, countryCode, currency }: FieldsProps) {
  return (
    <fieldset className="career-relocation-scenario-group">
      <legend>Основное</legend>
      <label>
        <span>Название сценария</span>
        <input
          maxLength={100}
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      <CityField
        city={draft.city}
        countryCode={countryCode}
        onChange={(city) => update({ city })}
      />
      <label>
        <span>Тип дохода</span>
        <select
          value={draft.incomeMode}
          onChange={(e) => update({ incomeMode: e.target.value as ScenarioDraft['incomeMode'] })}
        >
          {INCOME_MODES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {draft.incomeMode !== 'local_employment' ? (
        <ScenarioCostField
          label="Чистый доход в месяц"
          hidePayer
          currency={currency}
          value={draft.confirmedNetMonthly}
          onChange={(confirmedNetMonthly) => update({ confirmedNetMonthly })}
        />
      ) : null}
      <NumberField
        label="Резерв на жизнь, месяцев"
        value={draft.reserveMonths}
        min={0}
        max={36}
        onChange={(reserveMonths) => update({ reserveMonths: reserveMonths ?? 0 })}
      />
    </fieldset>
  );
}

/** Who moves: partner and children set the household size and the visa family facts. */
export function ScenarioFamilyFields({ draft, update }: Pick<FieldsProps, 'draft' | 'update'>) {
  const { family } = draft;
  return (
    <fieldset className="career-relocation-scenario-group">
      <legend>Кто переезжает</legend>
      <div className="career-relocation-scenario-choice" role="radiogroup" aria-label="Партнёр">
        {(
          [
            [false, 'Без партнёра'],
            [true, 'С партнёром'],
          ] as const
        ).map(([value, label]) => (
          <label key={label}>
            <input
              type="radio"
              name="scenario-partner"
              checked={family.hasPartner === value}
              onChange={() => update({ family: { ...family, hasPartner: value } })}
            />
            {label}
          </label>
        ))}
      </div>
      <label>
        <span>Сколько детей переезжает</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={15}
          step={1}
          value={family.children}
          onChange={(e) =>
            update({ family: { ...family, children: clampInt(e.target.value, 0, 15) } })
          }
        />
      </label>
      <p className="career-relocation-scenario-hint">
        В бюджете {scenarioHouseholdSize(family)} чел. Все суммы ниже — на всю семью.
        {family.children > 0 ? ' Школу и сад детей укажите в «Образование и дети».' : ''}
      </p>
    </fieldset>
  );
}

/** Regular costs per month or year, in the country's currency, each with its basis and date. */
export function ScenarioExpenses({ draft, update, countryCode, currency }: FieldsProps) {
  const reference = relocationHousingReferences[countryCode];
  const label = (key: (typeof RELOCATION_EXPENSES)[number]) =>
    key === 'education' && draft.family.children > 0
      ? `Школа и сад для детей (${draft.family.children})`
      : EXPENSE_LABELS[key];
  return (
    <details open className="career-relocation-scenario-group">
      <summary>Жильё и регулярные расходы</summary>
      {reference ? (
        <p className="career-relocation-scenario-hint">
          <a href={reference.url} target="_blank" rel="noreferrer">
            {reference.title}
          </a>
          : {reference.scope} Готовая цена не подставляется.
        </p>
      ) : null}
      {RELOCATION_EXPENSES.map((key) => (
        <ScenarioCostField
          key={key}
          label={label(key)}
          currency={currency}
          value={draft.expenses[key]}
          onChange={(value) => update({ expenses: { ...draft.expenses, [key]: value } })}
        />
      ))}
    </details>
  );
}

/** One-off costs, the funds a visa asks to show and whether those funds can be spent on living. */
export function ScenarioUpfront({ draft, update, currency }: Omit<FieldsProps, 'countryCode'>) {
  return (
    <details className="career-relocation-scenario-group">
      <summary>Разовые расходы и деньги на старт</summary>
      {RELOCATION_UPFRONT.map((key) => (
        <ScenarioCostField
          key={key}
          label={UPFRONT_LABELS[key]}
          currency={currency}
          once
          value={draft.upfront[key]}
          onChange={(value) => update({ upfront: { ...draft.upfront, [key]: value } })}
        />
      ))}
      <ScenarioCostField
        label="Средства для подтверждения визы"
        hidePayer
        currency={currency}
        once
        value={draft.proofOfFunds}
        onChange={(proofOfFunds) => update({ proofOfFunds })}
      />
      <label className="career-relocation-scenario-check">
        <input
          type="checkbox"
          checked={draft.proofFundsUsableForLiving}
          onChange={(e) => update({ proofFundsUsableForLiving: e.target.checked })}
        />
        Подтверждённые средства можно тратить на жизнь; считаем их частью резерва
      </label>
    </details>
  );
}

/** Route, citizenship, yes/no facts, remote income with a listed currency, experience. */
export function ScenarioVisa({ draft, update, countryCode, currency }: FieldsProps) {
  const { visa } = draft;
  const setVisa = (next: ScenarioDraft['visa']) => update({ visa: next });
  return (
    <details className="career-relocation-scenario-group">
      <summary>Условия визового маршрута</summary>
      <RouteField value={draft.scenarioId} onChange={(scenarioId) => update({ scenarioId })} />
      <VisaCitizenships visa={visa} setVisa={setVisa} />
      {Object.entries(VISA_FLAGS).map(([key, label]) => (
        <YesNoUnknown
          key={key}
          label={label}
          value={visa[key as keyof typeof VISA_FLAGS]}
          onChange={(value) => setVisa({ ...visa, [key]: value })}
        />
      ))}
      <MoneyWithCurrency
        label="Удалённый доход в месяц"
        value={visa.remoteMonthlyIncome}
        fallbackCurrency={currency}
        onChange={(remoteMonthlyIncome) => setVisa({ ...visa, remoteMonthlyIncome })}
      />
      <NumberField
        label="Соответствующий опыт, лет"
        value={visa.relevantExperienceYears}
        min={0}
        max={80}
        onChange={(relevantExperienceYears) => setVisa({ ...visa, relevantExperienceYears })}
      />
      <RelocationVisaExtras
        visa={visa}
        setVisa={setVisa}
        country={countryCode}
        currency={currency}
      />
    </details>
  );
}

/** A comparison rate: currency from the list, the rate per one unit of the country's currency. */
export function ScenarioComparison({ draft, update, currency }: Omit<FieldsProps, 'countryCode'>) {
  const comparisonCurrency = draft.comparisonRate?.currency ?? '';
  return (
    <details className="career-relocation-scenario-group">
      <summary>Курс для сравнения</summary>
      <p className="career-relocation-scenario-hint">
        Суммы переводятся только по указанному курсу: сколько единиц валюты сравнения за 1{' '}
        {currency}.
      </p>
      <CurrencySelect
        label="Валюта сравнения"
        value={comparisonCurrency}
        exclude={currency}
        onChange={(code) =>
          update({
            comparisonRate:
              draft.comparisonRate && code
                ? { ...draft.comparisonRate, currency: code }
                : undefined,
          })
        }
      />
      <ScenarioCostField
        label={`Курс за 1 ${currency}`}
        hidePayer
        currency={comparisonCurrency || 'EUR'}
        once
        value={draft.comparisonRate}
        onChange={(comparisonRate) => update({ comparisonRate })}
      />
    </details>
  );
}

/** Georgia pension and UAE nationality; the German childless surcharge follows the family. */
export function ScenarioPayroll({ draft, update, countryCode }: Omit<FieldsProps, 'currency'>) {
  const keys =
    countryCode === 'GE'
      ? (['georgiaPensionParticipant'] as const)
      : countryCode === 'AE'
        ? (['uaeNational'] as const)
        : [];
  if (!keys.length) return null;
  return (
    <details className="career-relocation-scenario-group">
      <summary>Параметры зарплатной модели</summary>
      {keys.map((key) => (
        <YesNoUnknown
          key={key}
          label={
            key === 'georgiaPensionParticipant'
              ? 'Участвую в пенсионной системе Грузии'
              : 'Гражданин ОАЭ'
          }
          value={draft.payrollOptions[key]}
          onChange={(value) =>
            update({ payrollOptions: { ...draft.payrollOptions, [key]: value } })
          }
        />
      ))}
    </details>
  );
}

function CityField({
  city,
  countryCode,
  onChange,
}: {
  readonly city: string;
  readonly countryCode: RelocationScenarioInput['countryCode'];
  readonly onChange: (city: string) => void;
}) {
  return (
    <label>
      <span>Город расчёта</span>
      <select value={city} onChange={(e) => onChange(e.target.value)}>
        <option value="">Выберите город</option>
        {RELOCATION_CITIES[countryCode].map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function RouteField({
  value,
  onChange,
}: {
  readonly value: ScenarioDraft['scenarioId'];
  readonly onChange: (value: ScenarioDraft['scenarioId']) => void;
}) {
  return (
    <label>
      <span>Маршрут</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ScenarioDraft['scenarioId'])}
      >
        {Object.entries(SCENARIOS).map(([key, label]) => (
          <option value={key} key={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A whole number in its own range; empty stays unknown. */
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number | undefined) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value ?? ''}
        onChange={(e) =>
          onChange(e.target.value === '' ? undefined : clampInt(e.target.value, min, max))
        }
      />
    </label>
  );
}

function YesNoUnknown({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: boolean | undefined;
  readonly onChange: (value: boolean | undefined) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
      >
        <option value="">Неизвестно</option>
        <option value="true">Да</option>
        <option value="false">Нет</option>
      </select>
    </label>
  );
}

export function CurrencySelect({
  label,
  value,
  exclude,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly exclude?: string;
  readonly onChange: (code: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Не выбрана</option>
        {RELOCATION_CURRENCIES.filter((code) => code !== exclude).map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MoneyWithCurrency({
  label,
  value,
  fallbackCurrency,
  onChange,
}: {
  readonly label: string;
  readonly value: { readonly amount: number; readonly currency: string } | undefined;
  readonly fallbackCurrency: string;
  readonly onChange: (value: { amount: number; currency: string } | undefined) => void;
}) {
  return (
    <div className="career-relocation-scenario-money">
      <label>
        <span>{label}</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value?.amount ?? ''}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? undefined
                : {
                    amount: Math.max(0, Number(e.target.value)),
                    currency: value?.currency ?? fallbackCurrency,
                  },
            )
          }
        />
      </label>
      <CurrencySelect
        label={`Валюта: ${label.toLocaleLowerCase('ru')}`}
        value={value?.currency ?? ''}
        onChange={(currency) => value && currency && onChange({ ...value, currency })}
      />
    </div>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  const value = Math.trunc(Number(raw));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
