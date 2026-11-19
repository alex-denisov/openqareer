import { Icon, InfoTip } from '../kit';
import type { SavedRelocationScenario } from '../../../../shared/relocationScenario';
import type { RelocationQuestionnaireResponse } from '../../relocation/relocationApi';
import type { CountryPay, RelocationPlace } from './relocationApi';
import type { ScenarioCountry } from './relocationCostsApi';
import type { Family } from './relocationCostsModel';
import { RelocationCosts } from './RelocationCosts';
import { cityName, formatMoney, placeTaxes, vacanciesLabel, workRight } from './relocationModel';

type ReadyPay = Extract<CountryPay, { state: 'ready' }>;

const dateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

function payTip(pay: ReadyPay): string {
  const sources = pay.sources.length > 0 ? `, ${pay.sources.join(', ')}` : '';
  const rate = pay.rateDate ? ` Курс ЦБ на ${dateLabel(pay.rateDate)}.` : '';
  return `Доход до налогов — середина вилок ${pay.sampleSize} вакансий страны${sources}, на ${dateLabel(pay.observedAt)}.${rate}`;
}

function Taxes({ place, pay }: { readonly place: RelocationPlace; readonly pay: ReadyPay }) {
  const taxes = placeTaxes(place.code, pay.median);
  if (!taxes) return null;
  return (
    <details className="rl-br">
      <summary className="row-act">Налоги и взносы</summary>
      <dl className="rl-calc" aria-label={`Расчёт: ${place.name}`}>
        {taxes.lines.map((line) => (
          <div className={line.minus ? 'rl-line is-minus' : 'rl-line'} key={line.label}>
            <dt>
              {line.label}
              {line.minus ? null : <InfoTip label="Источник" text={payTip(pay)} />}
            </dt>
            <dd className="rl-amt num">
              {line.minus ? '−' : ''}
              {formatMoney(line.amount, taxes.currency)}
            </dd>
          </div>
        ))}
        <div className="rl-line is-sum">
          <dt>На руки</dt>
          <dd className="rl-amt num">{formatMoney(taxes.net, taxes.currency)}</dd>
        </div>
      </dl>
    </details>
  );
}

function netLine(place: RelocationPlace): string {
  if (place.pay.state === 'error') return 'Зарплаты не прочитались';
  if (place.pay.state === 'thin') return 'Зарплаты: мало данных';
  const taxes = placeTaxes(place.code, place.pay.median);
  return taxes ? `на руки ${formatMoney(taxes.net, taxes.currency)}` : 'Зарплаты: мало данных';
}

/** Строка страны C06: место, «на руки», право работать; раскрытие — налоги и взносы. */
export interface RowContext {
  readonly questionnaire: RelocationQuestionnaireResponse | null;
  readonly scenario: SavedRelocationScenario | undefined;
  readonly family: Family | null;
  readonly onWho: () => void;
  readonly onConsent: () => void;
}

function Costs({
  place,
  pay,
  context,
}: {
  readonly place: RelocationPlace;
  readonly pay: ReadyPay;
  readonly context: RowContext;
}) {
  const taxes = placeTaxes(place.code, pay.median);
  if (!taxes) return null;
  const city = pay.city ? cityName(pay.city) : place.name;
  return (
    <RelocationCosts
      target={{
        countryCode: place.code as ScenarioCountry,
        countryName: place.name,
        city,
        currency: taxes.currency,
        grossMonthly: pay.median,
        scenarioId: workRight(place.fit).scenarioId,
        family: context.family,
      }}
      net={taxes.net}
      scenario={context.scenario}
      questionnaire={context.questionnaire}
      onWho={context.onWho}
      onConsent={context.onConsent}
    />
  );
}

export function RelocationRow({
  place,
  open,
  context,
}: {
  readonly place: RelocationPlace;
  readonly open: boolean;
  readonly context: RowContext;
}) {
  const right = workRight(place.fit);
  const city = place.pay.state === 'error' ? null : place.pay.city;
  const sub = [city ? cityName(city) : null, right.mode].filter(Boolean).join(' · ');
  const vacancies = place.pay.state === 'error' ? null : place.pay.vacancies;
  const main = (
    <span className="rl-main">
      <span className="row-title">{place.name}</span>
      {sub ? <span className="row-sub">{sub}</span> : null}
      <span className="row-sub num">{netLine(place)}</span>
      <span className="row-sub">
        <span className={`tag ${right.tag}`}>{right.text}</span>
      </span>
    </span>
  );
  const meta = vacancies ? <span className="row-meta num">{vacanciesLabel(vacancies)}</span> : null;
  if (place.pay.state !== 'ready')
    return (
      <li className="row rl-row">
        <div className="rl-sum">
          {main}
          {meta}
        </div>
      </li>
    );
  return (
    <li className="row rl-row">
      <details className="rl-d" open={open}>
        <summary className="rl-sum">
          {main}
          {meta}
          <Icon name="down" className="rl-chev" />
        </summary>
        <Taxes place={place} pay={place.pay} />
        <Costs place={place} pay={place.pay} context={context} />
      </details>
    </li>
  );
}
