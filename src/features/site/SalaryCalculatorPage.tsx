import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, PaperPlaneTilt } from '@phosphor-icons/react';
import {
  CALC_COUNTRIES,
  CALC_PATH,
  CALC_QUICK_AMOUNTS,
  RU_HIGH_RATE_FROM,
  calcCatalogHref,
  calcCountry,
  calcQueryString,
  calculateSalary,
  formatCalcMoney,
  parseCalcQuery,
  type CalcCountry,
  type CalcMode,
  type CalcResult,
} from '../../../shared/salaryCalculator';
import { SiteLink } from './SiteLink';
import { PublicFooter, PublicHeader } from './PublicSiteChrome';
import {
  CALC_DESCRIPTION,
  CALC_FAQ,
  CALC_NEXT,
  CALC_SCALE,
  CALC_STRUCTURED_DATA,
  CALC_TITLE,
} from './salaryCalculatorData';

export { CALC_DESCRIPTION, CALC_TITLE };

interface PageProps {
  readonly onNavigate: (path: string) => void;
  readonly signedIn?: boolean;
  readonly isAdmin?: boolean;
}

const digits = (value: string) => Number.parseInt(value.replace(/\D/gu, ''), 10) || 0;
const group = (amount: number) => amount.toLocaleString('ru-RU');

/** Rows past `keep` hide behind one button; `phoneOnly` folds just on phones. */
function FoldTable({
  keep,
  label,
  phoneOnly = false,
  stack = false,
  head,
  rows,
  footer,
}: {
  readonly keep: number;
  readonly label: string;
  readonly phoneOnly?: boolean;
  readonly stack?: boolean;
  readonly head: React.ReactNode;
  readonly rows: readonly React.ReactNode[];
  readonly footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const folds = rows.length > keep;
  const hidden = folds && !open ? (phoneOnly ? 'sc-fx-m' : 'sc-fx') : '';
  return (
    <>
      <div className="sc-card">
        <table className={`sc-dt${stack ? ' is-stack' : ''}`}>
          <thead>{head}</thead>
          <tbody className={hidden}>{rows}</tbody>
        </table>
        {footer}
      </div>
      {folds ? (
        <button
          type="button"
          className={`sc-btn sc-fold${phoneOnly ? ' is-phone' : ''}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Свернуть' : label}
        </button>
      ) : null}
    </>
  );
}

function Segmented<T extends string>({
  labelId,
  items,
  value,
  onPick,
}: {
  readonly labelId: string;
  readonly items: readonly { readonly id: T; readonly label: string }[];
  readonly value: T;
  readonly onPick: (id: T) => void;
}) {
  return (
    <div className="sc-seg" role="group" aria-labelledby={labelId}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.id === value}
          onClick={() => onPick(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

const MODES: readonly { id: CalcMode; label: string }[] = [
  { id: 'gross', label: 'Зарплата до налогов' },
  { id: 'net', label: 'Сумма на руки' },
];

function Output({
  result,
  mode,
  onNavigate,
  onShare,
  copied,
}: {
  readonly result: CalcResult;
  readonly mode: CalcMode;
  readonly onNavigate: (path: string) => void;
  readonly onShare: () => void;
  readonly copied: boolean;
}) {
  const { country } = result;
  const ru = country.code === 'RU';
  const label = copied ? 'Ссылка скопирована' : 'Скопировать ссылку на расчёт';
  const big =
    mode === 'net'
      ? formatCalcMoney(result.gross, country.symbol)
      : formatCalcMoney(result.netMonthly, country.symbol);
  const bigLabel =
    mode === 'net'
      ? 'Зарплата до налогов в месяц'
      : ru
        ? 'На руки в месяц, в среднем за год'
        : 'На руки в месяц';
  return (
    <div className="sc-out" aria-live="polite">
      <span className="sc-label">{bigLabel}</span>
      <span className="sc-big">{big}</span>
      <div className="sc-r2">
        <span>{ru ? 'НДФЛ за год' : 'Налоги и взносы за год'}</span>
        <b>{formatCalcMoney(result.annualTax, country.symbol)}</b>
      </div>
      <div className="sc-r2 sc-hide-m">
        <span>На руки за год</span>
        <b>{formatCalcMoney(result.netYear, country.symbol)}</b>
      </div>
      {ru ? (
        <div className="sc-r2">
          <span>Ставка выросла до 15 %</span>
          <b>{result.raisedFrom ?? 'не выросла'}</b>
        </div>
      ) : null}
      <div className="sc-act">
        <SiteLink
          to={calcCatalogHref(result)}
          onNavigate={onNavigate}
          className="sc-btn is-primary"
        >
          Показать вакансии от {formatCalcMoney(result.gross, country.symbol)}
        </SiteLink>
        <button
          type="button"
          className="sc-btn sc-share"
          aria-label={label}
          title={label}
          onClick={onShare}
        >
          <PaperPlaneTilt size={16} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function MonthsTable({ result }: { readonly result: CalcResult }) {
  const { symbol } = result.country;
  const money = (value: number) => formatCalcMoney(value, symbol);
  return (
    <FoldTable
      keep={3}
      label="Все 12 месяцев"
      head={
        <tr>
          <th>Месяц</th>
          <th className="n">Доход с начала года</th>
          <th className="n">Ставка</th>
          <th className="n">НДФЛ</th>
          <th className="n">На руки</th>
        </tr>
      }
      rows={result.months.map((row) => (
        <tr key={row.month}>
          <td>{row.month}</td>
          <td className="n">{money(row.cumulative)}</td>
          <td className={`n${row.raised ? ' hl' : ''}`}>{row.rate}&nbsp;%</td>
          <td className="n">{money(row.tax)}</td>
          <td className="n">{money(row.net)}</td>
        </tr>
      ))}
    />
  );
}

function QuickTable() {
  const rows = CALC_QUICK_AMOUNTS.map((amount) => {
    const r = calculateSalary('RU', amount, 'gross');
    const money = (value: number) => formatCalcMoney(value, '₽');
    return (
      <tr key={amount}>
        <td>{money(amount)}</td>
        <td className="n" data-l="НДФЛ">
          {money(r.annualTax / 12)}
        </td>
        <td className="n" data-l="На руки">
          <b>{money(r.netMonthly)}</b>
        </td>
      </tr>
    );
  });
  return (
    <FoldTable
      keep={3}
      phoneOnly
      stack
      label="Все суммы"
      head={
        <tr>
          <th>До налогов в месяц</th>
          <th className="n">НДФЛ в месяц, в среднем</th>
          <th className="n">На руки в месяц, в среднем</th>
        </tr>
      }
      rows={rows}
      footer={
        <div className="sc-card-f">
          При зарплате выше 200 000 ₽ в месяц доход за год превышает 2,4 млн ₽, и с превышения
          берут 15 %. Источник ставок: ФНС России.
        </div>
      }
    />
  );
}

function useCalculator() {
  const [country, setCountry] = useState<CalcCountry>('RU');
  const [mode, setMode] = useState<CalcMode>('gross');
  const [amount, setAmount] = useState(300000);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const query = parseCalcQuery(window.location.search);
    if (query.country) setCountry(query.country);
    if (query.mode) setMode(query.mode);
    setAmount(query.amount ?? (query.country ? calcCountry(query.country)!.defaultGross : 300000));
  }, []);
  const result = useMemo(() => calculateSalary(country, amount, mode), [country, amount, mode]);
  const remember = (next: { country: CalcCountry; mode: CalcMode; amount: number }) => {
    window.history.replaceState(window.history.state, '', `${CALC_PATH}${calcQueryString(next)}`);
  };
  const pickCountry = (next: CalcCountry) => {
    const value = calcCountry(next)!.defaultGross;
    setCountry(next);
    setAmount(value);
    remember({ country: next, mode, amount: value });
  };
  const pickMode = (next: CalcMode) => {
    setMode(next);
    remember({ country, mode: next, amount });
  };
  const typeAmount = (value: string) => {
    const next = digits(value);
    setAmount(next);
    remember({ country, mode, amount: next });
  };
  const share = () => {
    remember({ country, mode, amount });
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(window.location.href).then(done, done);
    else done();
  };
  return { country, mode, amount, result, copied, pickCountry, pickMode, typeAmount, share };
}

function Calculator({ onNavigate }: { readonly onNavigate: (path: string) => void }) {
  const calc = useCalculator();
  const { result, mode, country } = calc;
  const info = result.country;
  return (
    <>
      <section className="sc-calc">
        <div className="sc-wrap">
          <div className="sc-box">
            <form className="sc-in" onSubmit={(event) => event.preventDefault()}>
              <div className="sc-field">
                <span className="sc-lab" id="sc-cc">
                  Страна
                </span>
                <Segmented
                  labelId="sc-cc"
                  items={CALC_COUNTRIES.map((c) => ({ id: c.code, label: c.label }))}
                  value={country}
                  onPick={calc.pickCountry}
                />
              </div>
              <div className="sc-field">
                <span className="sc-lab" id="sc-dir">
                  Считать от
                </span>
                <Segmented labelId="sc-dir" items={MODES} value={mode} onPick={calc.pickMode} />
              </div>
              <div className="sc-field">
                <label htmlFor="sc-g">
                  {mode === 'gross'
                    ? 'Зарплата до налогов в месяц'
                    : 'Сколько хотите на руки в месяц'}
                </label>
                <div className="sc-money">
                  <input
                    className="sc-input"
                    id="sc-g"
                    inputMode="numeric"
                    value={group(calc.amount)}
                    onChange={(event) => calc.typeAmount(event.target.value)}
                  />
                  <span>{info.symbol}</span>
                </div>
              </div>
              <p className="sc-small">{info.note}</p>
            </form>
            <Output
              result={result}
              mode={mode}
              onNavigate={onNavigate}
              onShare={calc.share}
              copied={calc.copied}
            />
          </div>
          <div className="sc-under">
            <p className="sc-small">
              Ставки: ФНС России, 2026 год. Расчёт не заменяет консультацию бухгалтера.
            </p>
            <p>
              <SiteLink to="/salaries" onNavigate={onNavigate} className="sc-link">
                Сравните с рынком своей профессии <ArrowRight size={16} aria-hidden="true" />
              </SiteLink>
              <SiteLink to="/tariffs?from=calc" onNavigate={onNavigate} className="sc-link">
                Какую сумму назвать на собеседовании — подготовка к торгу в Pro{' '}
                <ArrowRight size={16} aria-hidden="true" />
              </SiteLink>
            </p>
          </div>
        </div>
      </section>
      <section className="sc-s">
        <div className="sc-wrap">
          {country === 'RU' ? (
            <div className="sc-months" id="months">
              <h2 className="sc-h3">По месяцам</h2>
              <MonthsTable result={result} />
            </div>
          ) : null}
          <p className="sc-answer">
            <b>Коротко:</b> со 150 000 ₽ до налогов на руки 130 500 ₽, с 300 000 ₽ — в среднем 259
            000 ₽ в месяц (ставки НДФЛ ФНС России на 2026 год).
          </p>
        </div>
      </section>
    </>
  );
}

function Sh({
  label,
  title,
  text,
  one = false,
}: {
  readonly label: string;
  readonly title: string;
  readonly text?: string;
  readonly one?: boolean;
}) {
  return (
    <div className={`sc-sh${one ? ' is-one' : ''}`}>
      <div>
        <span className="sc-label">{label}</span>
        <h2>{title}</h2>
      </div>
      {text ? <p>{text}</p> : null}
    </div>
  );
}

function Lower({ onNavigate }: { readonly onNavigate: (path: string) => void }) {
  return (
    <>
      <section className="sc-s">
        <div className="sc-wrap">
          <Sh
            label="Готовые ответы"
            title="Сколько на руки с популярных зарплат"
            text="Налоговый резидент РФ, без вычетов. Ставки 2026 года, проверено 26.10.2026."
          />
          <QuickTable />
        </div>
      </section>
      <section className="sc-s">
        <div className="sc-wrap">
          <Sh
            label="Шкала НДФЛ 2026"
            title="Пять ставок, и каждая — только на свою часть дохода"
            text={`Доход за год делится на части. С 3 млн ₽ за год 13 % берут с первых ${(RU_HIGH_RATE_FROM / 1e6).toLocaleString('ru-RU')} млн ₽ и 15 % — с оставшихся 600 тыс. ₽.`}
          />
          <div className="sc-scale">
            {CALC_SCALE.map((band, index) => (
              <div key={band.rate} className={index === 0 ? 'me' : undefined}>
                <b>{band.rate}</b>
                <span>{band.range}</span>
              </div>
            ))}
          </div>
          <p className="sc-src">
            Источник:{' '}
            <a
              href="https://www.nalog.gov.ru/rn26/news/activities_fts/16653428/"
              rel="noopener"
            >
              ФНС России, ставки НДФЛ по основной налоговой базе в 2026 году
            </a>
            .
          </p>
        </div>
      </section>
      <section className="sc-s">
        <div className="sc-wrap">
          <Sh
            label="Что дальше"
            title="Знаете, сколько хотите на руки? Найдите, где столько платят"
            one
          />
          <div className="sc-hint">
            {CALC_NEXT.map((item) => (
              <SiteLink key={item.href} to={item.href} onNavigate={onNavigate}>
                <b>{item.title}</b>
                <span>{item.text}</span>
              </SiteLink>
            ))}
          </div>
        </div>
      </section>
      <section className="sc-s">
        <div className="sc-wrap">
          <Sh label="Вопросы" title="Про НДФЛ и зарплату на руки" />
          <div className="sc-faq">
            {[CALC_FAQ.slice(0, 2), CALC_FAQ.slice(2)].map((column) => (
              <div key={column[0].q}>
                {column.map((item) => (
                  <details key={item.q} className="sc-q" open={item === CALC_FAQ[0]}>
                    <summary>{item.q}</summary>
                    <div className="sc-a">{item.a}</div>
                  </details>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function SalaryCalculatorPage({ onNavigate, signedIn = false, isAdmin = false }: PageProps) {
  useEffect(() => {
    document.title = CALC_TITLE;
  }, []);
  return (
    <div className="ps sc-page">
      <a className="ps-skip" href="#main">
        К содержимому
      </a>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(CALC_STRUCTURED_DATA).replace(/</gu, '\\u003c'),
        }}
      />
      <PublicHeader
        onNavigate={onNavigate}
        onLanding={false}
        signedIn={signedIn}
        isAdmin={isAdmin}
        current="tools"
      />
      <main id="main">
        <nav className="sc-wrap sc-crumbs" aria-label="Хлебные крошки">
          <SiteLink to="/" onNavigate={onNavigate}>
            Главная
          </SiteLink>
          <span aria-hidden="true">/</span>
          <SiteLink to="/salaries" onNavigate={onNavigate}>
            Зарплаты
          </SiteLink>
          <span aria-hidden="true">/</span>
          <span>Калькулятор на руки</span>
        </nav>
        <section className="sc-hero">
          <div className="sc-wrap">
            <span className="sc-eyebrow">Ставки 2026 года · 6 стран</span>
            <h1>Калькулятор зарплаты на руки и НДФЛ на 2026 год</h1>
            <p className="sc-lead">
              Введите зарплату до налогов — увидите сумму на руки по месяцам. Калькулятор учитывает
              прогрессивную шкалу: после 2,4 млн ₽ за год ставка растёт только на превышение.
            </p>
          </div>
        </section>
        <Calculator onNavigate={onNavigate} />
        <Lower onNavigate={onNavigate} />
      </main>
      <PublicFooter onNavigate={onNavigate} onLanding={false} signedIn={signedIn} planBar />
    </div>
  );
}
