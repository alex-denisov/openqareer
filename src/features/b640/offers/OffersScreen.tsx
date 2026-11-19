import { useCallback, useId, useState } from 'react';
import type { CurrencyRates } from '../../../../shared/currencyRates';
import { LiveConsultantRequest, LIVE_CONSULTANT_PRICE } from '../account/LiveConsultant';
import { Button, Icon, InfoTip, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { useScreenChrome } from '../shell/ShellContext';
import { loadOffers, type OffersData } from './data/offersApi';
import { OfferDecision } from './OfferDecision';
import {
  compareLine,
  conditionRows,
  formatDay,
  leadTitle,
  payText,
  type CurrencyChoice,
  type OfferCard,
} from './model/offerModel';

const CURRENCIES: readonly {
  readonly value: CurrencyChoice;
  readonly label: string;
  readonly name?: string;
}[] = [
  { value: 'RUB', label: '₽', name: 'рубли' },
  { value: 'USD', label: '$', name: 'доллары' },
  { value: 'EUR', label: '€', name: 'евро' },
  { value: 'ORIG', label: 'Как в вакансии' },
];

export const NEW_OFFER_ID = 'new';

function rateNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
}

function ratesTip(rates: CurrencyRates | null): string {
  const usd = rates?.rubPerUnit.USD;
  const eur = rates?.rubPerUnit.EUR;
  if (!rates || !usd || !eur) return 'Курса ЦБ пока нет — суммы показаны как в вакансии, без «≈».';
  return `Пересчёт по курсу ЦБ на ${formatDay(rates.date) ?? rates.date}: 1 $ = ${rateNumber(usd)} ₽, 1 € = ${rateNumber(eur)} ₽. Нет курса — исходная сумма без «≈».`;
}

function CurrencySwitch(props: {
  readonly value: CurrencyChoice;
  readonly rates: CurrencyRates | null;
  readonly onChange: (value: CurrencyChoice) => void;
}) {
  const name = useId();
  return (
    <div className="cmp-ccy">
      <fieldset className="ccy">
        <legend className="vh">Валюта денег</legend>
        <div className="ccy-seg">
          {CURRENCIES.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={props.value === option.value}
                onChange={() => props.onChange(option.value)}
              />
              <span aria-label={option.name}>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <InfoTip label="Как пересчитаны деньги" text={ratesTip(props.rates)} />
    </div>
  );
}

function PayCell(props: {
  readonly card: OfferCard;
  readonly choice: CurrencyChoice;
  readonly rates: CurrencyRates | null;
}) {
  const pay = payText(props.card, props.choice, props.rates);
  return (
    <td data-col={props.card.company}>
      {pay.text}
      {pay.needsTax ? (
        <>
          {' · '}
          <Link
            className="row-act"
            to={buildNodePath('o06a', { offerId: props.card.applicationId })}
          >
            Указать налог — пересчитаем на руки
          </Link>
        </>
      ) : null}
    </td>
  );
}

function CompareTable(props: { readonly data: OffersData; readonly choice: CurrencyChoice }) {
  const { cards, rates } = props.data;
  return (
    <table className={cards.length === 2 ? 'cmp two' : 'cmp'}>
      <thead>
        <tr>
          <th scope="col">
            <span className="vh">Условие</span>
          </th>
          {cards.map((card) => (
            <th scope="col" key={card.applicationId}>
              {card.company}
              {card.title ? <small>{card.title}</small> : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Оклад на руки</th>
          {cards.map((card) => (
            <PayCell key={card.applicationId} card={card} choice={props.choice} rates={rates} />
          ))}
        </tr>
        {conditionRows(cards).map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            {row.cells.map((cell, index) => (
              <td key={cards[index].applicationId} data-col={cards[index].company}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OffersEmpty() {
  return (
    <section className="lead col-wide" aria-labelledby="of-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="of-title">
          Офферов пока нет
        </h2>
        <InfoTip
          label="Откуда берутся офферы"
          text="Оффер из отклика появится сам, когда вы отметите ответ работодателя. Пришёл вне откликов — добавьте вручную или вставьте текст письма: поля заполним, вы проверите."
        />
      </div>
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('o06a', { offerId: NEW_OFFER_ID })}>
          <Icon name="plus" />
          Добавить оффер
        </Link>
      </div>
    </section>
  );
}

function OffersLead({ data }: { readonly data: OffersData }) {
  const [choice, setChoice] = useState<CurrencyChoice>('RUB');
  return (
    <section className="lead col-wide" aria-labelledby="of-title">
      <h2 className="lead-title is-long" id="of-title">
        {leadTitle(data.cards, data.floor, data.rates)}
      </h2>
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('k01')}>
          <Icon name="chat" />
          Подготовить встречное
        </Link>
      </div>
      <p className="only-mob cmp-line num">{compareLine(data.cards, choice, data.rates)}</p>
      <details className="more-n m-fold cmp-fold">
        <summary>
          <Icon name="down" />
          Все 6 условий рядом
        </summary>
        <CurrencySwitch value={choice} rates={data.rates} onChange={setChoice} />
        <CompareTable data={data} choice={choice} />
      </details>
      <OfferDecision card={data.cards[0]} />
      <div className="cons-line">
        <span>
          Разобрать торг с живым консультантом ·{' '}
          <b className="num">{LIVE_CONSULTANT_PRICE.replace(/ /g, '\u00a0')}</b>
        </span>
        <LiveConsultantRequest />
      </div>
    </section>
  );
}

let savedFlash = false;

/** O6a отмечает сохранение перед переходом; O6 показывает строку один раз (состояние A o06c). */
export function flashOfferSaved(): void {
  savedFlash = true;
}

function takeSavedFlash(): boolean {
  const saved = savedFlash;
  savedFlash = false;
  return saved;
}

/** «Офферы» (O6): сравнение, решение по ближайшему сроку, торг; без офферов — O6b. */
export function OffersScreen() {
  const load = useCallback((signal: AbortSignal) => loadOffers(signal), []);
  const { state, reload } = useAsync(load, 'Офферы не загрузились.');
  const [saved] = useState(takeSavedFlash);
  useScreenChrome({ rootData: { mtight: '1' } });
  return (
    <div className="page two" data-b640-node="o06" data-b640-section="offers">
      {saved ? (
        <div className="col-wide">
          <StatusLine state="ok" text="Условия сохранены" />
        </div>
      ) : null}
      {state.status === 'ready' ? (
        state.data.cards.length === 0 ? (
          <OffersEmpty />
        ) : (
          <OffersLead data={state.data} />
        )
      ) : state.status === 'error' ? (
        <StatusLine
          state="err"
          text={state.error}
          action={
            <Button size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        />
      ) : (
        <p className="ls-state" role="status">
          Загружаем офферы…
        </p>
      )}
    </div>
  );
}
