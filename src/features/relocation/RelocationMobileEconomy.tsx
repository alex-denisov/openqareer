import { CheckCircle, Info, Scales } from '@phosphor-icons/react';
import { getCountryTaxData, supportedCountryCodes } from '../../../shared/taxData';
import { calculateRelocationEconomy, listRelocationCountries } from './relocationCountryData';
import { MobileGroup, MobileInputRow, MobilePickerRow } from './mobile/MobileRows';
import { mobileDate } from './mobile/MobileSteps';

export interface RelocationMobileEconomyProps {
  readonly selectedCountryCodes: readonly string[];
  readonly selectedCountryCode: string;
  readonly grossAnnualIncome: number | undefined;
  readonly onCountryCodeChange: (countryCode: string) => void;
  readonly onGrossAnnualIncomeChange: (amount: number | undefined) => void;
}

const SLIDER_MAX = 300_000;
const SLIDER_STEP = 1_000;

type Payroll = Extract<
  ReturnType<typeof calculateRelocationEconomy>,
  { readonly status: 'available' }
>['payroll'];

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function share(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)} %`;
}

/** The salary row of mockup 15 `vt=net`: value on the right and a slider under it. */
function SalaryRows({
  income,
  currency,
  onChange,
}: {
  readonly income: number | undefined;
  readonly currency: string;
  readonly onChange: (amount: number | undefined) => void;
}) {
  return (
    <>
      <MobileInputRow
        id="relocation-mobile-income"
        label={`Зарплата в год до налогов${currency ? `, ${currency}` : ''}`}
        type="number"
        value={income === undefined ? '' : String(income)}
        onChange={(value) => onChange(value === '' ? undefined : Math.max(0, Number(value)))}
      />
      <div className="vacancy-push-kv career-relocation-slider-row">
        <input
          type="range"
          min={0}
          max={SLIDER_MAX}
          step={SLIDER_STEP}
          value={Math.min(income ?? 0, SLIDER_MAX)}
          aria-label="Годовая зарплата до налогов"
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </>
  );
}

function Breakdown({ payroll }: { readonly payroll: Payroll }) {
  const gross = payroll.grossAnnualIncome;
  const parts = [
    { key: 'tax', label: 'Налог на доход', amount: payroll.incomeTax.amount, tone: 'is-tax' },
    ...payroll.employeeContributions.items.map((item) => ({
      key: item.name,
      label: item.name,
      amount: item.amount,
      tone: 'is-contribution',
    })),
    { key: 'net', label: 'Остаток после налогов', amount: payroll.netAnnualIncome, tone: 'is-net' },
  ];
  return (
    <>
      <EconomyBar parts={parts} />
      <MobileGroup
        caption="Раскладка"
        note={`Остаток ${money(payroll.netMonthlyIncome, payroll.currency)} в месяц. Аренда и страховка не учтены: для них нет проверенных источников.`}
      >
        {parts.map((part) => (
          <div key={part.key} className="vacancy-push-kv">
            <span>
              <i className={`career-relocation-economy-dot ${part.tone}`} aria-hidden="true" />
              {part.label}
            </span>
            <b>{share(part.amount, gross)}</b>
          </div>
        ))}
      </MobileGroup>
    </>
  );
}

function Sources({ payroll }: { readonly payroll: Payroll }) {
  const sources = [
    payroll.incomeTax.source,
    ...payroll.employeeContributions.items.map(({ source }) => source),
  ].filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index);
  return (
    <MobileGroup
      caption="Откуда цифры"
      note="Без льгот и вычетов на семью. Не заменяет консультацию налогового специалиста."
    >
      {sources.map((source) => (
        <a
          key={source.url}
          className="vacancy-push-row"
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="vacancy-push-ico">
            <Scales aria-hidden="true" />
          </span>
          <span className="vacancy-push-main">
            <b>{source.title}</b>
            <small>
              шкала {source.dataYear}, получено {mobileDate(source.retrievedAt)}
            </small>
          </span>
        </a>
      ))}
    </MobileGroup>
  );
}

function Notice({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <p className="career-relocation-push-why" role="status">
      <Info aria-hidden="true" size={18} />
      <span>
        <b>{title}.</b> {detail}
      </span>
    </p>
  );
}

function Result({
  countryCode,
  income,
}: {
  readonly countryCode: string;
  readonly income: number | undefined;
}) {
  if (!countryCode)
    return (
      <Notice
        title="Выберите страну"
        detail="Расчёт использует годовую зарплату и налоговую шкалу страны."
      />
    );
  if (!supportedCountryCodes.some((code) => code === countryCode)) {
    return (
      <Notice
        title="Налоговая шкала не подключена"
        detail="Для этой страны расчёт не выполняется, пока нет проверенных налоговых данных."
      />
    );
  }
  if (income === undefined || income <= 0)
    return (
      <Notice title="Укажите зарплату" detail="Пока сумма не указана, расчёт не выполняется." />
    );
  const result = calculateRelocationEconomy(countryCode, income);
  if (result.status !== 'available')
    return (
      <p className="career-relocation-error" role="alert">
        {result.reason}
      </p>
    );
  return (
    <>
      <Breakdown payroll={result.payroll} />
      <Sources payroll={result.payroll} />
    </>
  );
}

/** Mockup 15 `vt=net` at 390: country and salary rows, the split as a bar and a list, sources. */
export function RelocationMobileEconomy(props: RelocationMobileEconomyProps) {
  const countryCode = props.selectedCountryCode || props.selectedCountryCodes[0] || '';
  const supported = supportedCountryCodes.some((code) => code === countryCode);
  const currency = supported ? getCountryTaxData(countryCode).currency : '';
  const options = [
    ['', 'Выберите'] as const,
    ...listRelocationCountries().map(({ countryCode: code, name }) => [code, name] as const),
  ];
  return (
    <div className="career-relocation-mobile-section">
      <MobileGroup>
        <MobilePickerRow
          id="relocation-mobile-economy-country"
          icon={supported ? <CheckCircle aria-hidden="true" /> : <Info aria-hidden="true" />}
          label="Страна"
          value={countryCode}
          options={options}
          onChange={(code) => {
            props.onCountryCodeChange(code);
            props.onGrossAnnualIncomeChange(undefined);
          }}
        />
        <SalaryRows
          income={props.grossAnnualIncome}
          currency={currency}
          onChange={props.onGrossAnnualIncomeChange}
        />
      </MobileGroup>
      <Result countryCode={countryCode} income={props.grossAnnualIncome} />
    </div>
  );
}

/** Shares as SVG rect widths: attributes, not inline styles, so the CSP stays strict. */
function EconomyBar({
  parts,
}: {
  readonly parts: readonly {
    readonly key: string;
    readonly amount: number;
    readonly tone: string;
  }[];
}) {
  const total = parts.reduce((sum, part) => sum + Math.max(part.amount, 0), 0);
  if (total <= 0) return null;
  let offset = 0;
  return (
    <svg
      className="career-relocation-economy-bar"
      viewBox="0 0 100 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {parts.map((part) => {
        const width = (Math.max(part.amount, 0) / total) * 100;
        const x = offset;
        offset += width;
        return <rect key={part.key} className={part.tone} x={x} y={0} width={width} height={1} />;
      })}
    </svg>
  );
}
