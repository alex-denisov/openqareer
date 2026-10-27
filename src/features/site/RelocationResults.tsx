import React, { useState } from 'react';
import { CheckCircle, Clock, XCircle } from '@phosphor-icons/react';
import {
  RELOCATION_MAX_COUNTRIES,
  type RelocationAnswers,
  type RelocationCard,
  type RelocationMoney,
  type RequirementMark,
} from '../../../shared/countryFit/relocationEstimate';
import type { TaxDataSource } from '../../../shared/taxData/types';
import { COUNTRY_CODES } from './countryFitScenario';
import {
  FAMILY_LABELS,
  PROFESSION_LABELS,
  citizenshipLabel,
  countryName,
} from './RelocationWizard';

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

function sourceHost(source: TaxDataSource): string {
  try {
    return new URL(source.url).hostname.replace(/^www\./u, '');
  } catch {
    return source.title;
  }
}

const MARK_ICON: Readonly<Record<RequirementMark, React.ReactNode>> = {
  ok: <CheckCircle size={16} weight="bold" aria-label="Выполнено" />,
  check: <Clock size={16} weight="bold" aria-label="Нужно проверить" />,
  barrier: <XCircle size={16} weight="bold" aria-label="Препятствие" />,
};

function MoneyRow({
  money,
  answers,
}: {
  readonly money: RelocationMoney;
  readonly answers: RelocationAnswers;
}) {
  const net = formatMoney(answers.netMonthly, answers.netCurrency);
  if (money.kind === 'no_income_tax') {
    return (
      <div className="rl-money">
        <span>Налога на доход нет: на руки</span>
        <b>= до налогов</b>
      </div>
    );
  }
  if (money.kind === 'other_currency') {
    return (
      <div className="rl-money">
        <span>
          Сумма указана в {answers.netCurrency}, зарплата здесь в {money.currency}: курс без
          источника не берём. <a href="/tools/country-fit">Посчитать в {money.currency}</a>
        </span>
      </div>
    );
  }
  return (
    <div className="rl-money">
      <span>
        Чтобы {net} на руки, нужно до налогов в месяц (ставки {money.taxYear})
      </span>
      <b>≈ {formatMoney(money.grossMonthly, money.currency)}</b>
    </div>
  );
}

function Sources({ sources }: { readonly sources: readonly TaxDataSource[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="rl-src">
      Источник:{' '}
      {sources.map((source, index) => (
        <React.Fragment key={source.url}>
          {index > 0 && ', '}
          <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
            {sourceHost(source)}
          </a>
        </React.Fragment>
      ))}
      , проверено {formatDate(sources[0]?.retrievedAt ?? '')}
    </p>
  );
}

function ResultCard({
  card,
  rank,
  answers,
}: {
  readonly card: RelocationCard;
  readonly rank: number;
  readonly answers: RelocationAnswers;
}) {
  const top = rank === 0 && card.kind === 'path';
  return (
    <article className={top ? 'rl-card is-top' : 'rl-card'}>
      <div className="rl-rt">
        <span className="rl-rk">
          {rank + 1}
          {top ? ' · лучше всего подходит' : ''}
        </span>
        <h3>{card.countryName}</h3>
        <span className="rl-way">
          {card.kind === 'path' ? card.pathLabel : 'Проверенного пути нет'}
        </span>
        {card.scenarioLabel && <span className="rl-scn">{card.scenarioLabel}</span>}
      </div>
      {card.kind === 'path' ? (
        <ul>
          {card.requirements.map((line) => (
            <li key={line.text} className={`is-${line.mark}`}>
              {MARK_ICON[line.mark]}
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rl-none">{card.reason}</p>
      )}
      <Sources sources={card.sources} />
      <MoneyRow money={card.money} answers={answers} />
    </article>
  );
}

export function answersSummary(answers: RelocationAnswers): string {
  const experience =
    answers.experienceYears >= 10 ? '10+ лет опыта' : `${answers.experienceYears} лет опыта`;
  return [
    citizenshipLabel(answers.citizenship),
    `${PROFESSION_LABELS[answers.profession]}, ${experience}, ${answers.hasDegree ? 'с дипломом' : 'без диплома'}`,
    answers.english === 'none' ? 'без английского' : `английский ${answers.english}`,
    FAMILY_LABELS[answers.family].toLowerCase(),
    `хочу ${formatMoney(answers.netMonthly, answers.netCurrency)} на руки`,
    answers.countries.map(countryName).join(', '),
  ].join(' · ');
}

function CopyLinkButton({ href }: { readonly href: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
      setState('done');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2_500);
  };
  return (
    <button type="button" className="ps-btn is-lg rl-copy" onClick={() => void copy()}>
      {state === 'done'
        ? 'Ссылка скопирована'
        : state === 'failed'
          ? 'Скопируйте адрес страницы'
          : 'Скопировать ссылку'}
    </button>
  );
}

function SaveEstimate({ shareHref }: { readonly shareHref: string }) {
  return (
    <>
      <div className="rl-notcount">
        <p>
          <b>Что ещё не учтено:</b> признание диплома, документы для партнёра, вакансии в стране под
          вашу профессию и сколько стоит жизнь. Это следующий шаг — ваши 6 ответов перенесутся в
          полную анкету.
        </p>
        <div className="rl-save">
          <a className="ps-btn is-primary is-lg" href="/signup?from=relocation">
            Сохранить оценку — бесплатно
          </a>
          <CopyLinkButton href={shareHref} />
        </div>
      </div>
      <p className="rl-pro">
        Полная оценка переезда — документы и ограничения профиля — в Pro.{' '}
        <a href="/signup?plan=pro&from=relocation">Полная оценка в Pro</a>
      </p>
    </>
  );
}

function CountryPicker({
  countries,
  onChange,
}: {
  readonly countries: readonly string[];
  readonly onChange: (countries: readonly string[]) => void;
}) {
  const full = countries.length >= RELOCATION_MAX_COUNTRIES;
  return (
    <div className="rl-cpick" role="group" aria-label="Страны для сравнения">
      <span className="rl-small">Сравнить страны:</span>
      {countries.map((code) => (
        <button
          key={code}
          type="button"
          className="ps-chip is-blue rl-cchip"
          aria-label={`Убрать ${countryName(code)}`}
          disabled={countries.length === 1}
          onClick={() => onChange(countries.filter((item) => item !== code))}
        >
          {countryName(code)} ×
        </button>
      ))}
      {full ? (
        <span className="rl-small">Можно сравнить до трёх стран</span>
      ) : (
        <select
          className="rl-cadd"
          aria-label="Добавить страну"
          value=""
          onChange={(event) => event.target.value && onChange([...countries, event.target.value])}
        >
          <option value="">+ Добавить страну</option>
          {COUNTRY_CODES.filter((code) => !countries.includes(code)).map((code) => (
            <option key={code} value={code}>
              {countryName(code)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

const PATHS_HEADING: Readonly<Record<number, string>> = {
  1: 'Путь, который вам открыт',
  2: 'Два пути, которые вам открыты',
  3: 'Три пути, которые вам открыты',
};

interface RelocationResultsProps {
  readonly answers: RelocationAnswers;
  readonly cards: readonly RelocationCard[];
  readonly isExample: boolean;
  readonly shareHref: string;
  readonly onCountriesChange: (countries: readonly string[]) => void;
}

export function RelocationResults({
  answers,
  cards,
  isExample,
  shareHref,
  onCountriesChange,
}: RelocationResultsProps) {
  const count = cards.length;
  return (
    <section className="rl-s" id="result" aria-labelledby="rl-result-h">
      <div className="ps-wrap">
        <div className="rl-res-h">
          <div>
            <span className="ps-label">{isExample ? 'Пример результата' : 'Ваш результат'}</span>
            <h2 id="rl-result-h">{PATHS_HEADING[count] ?? PATHS_HEADING[3]}</h2>
          </div>
          <span className="ps-chip is-warn">
            <Clock size={14} weight="bold" aria-hidden="true" />
            Предварительная оценка по 6 ответам
          </span>
        </div>
        <CountryPicker countries={answers.countries} onChange={onCountriesChange} />
        <p className="rl-sum">Ответы: {answersSummary(answers)}.</p>
        <div className="rl-rc">
          {cards.map((card, index) => (
            <ResultCard key={card.countryCode} card={card} rank={index} answers={answers} />
          ))}
        </div>
        <SaveEstimate shareHref={shareHref} />
      </div>
    </section>
  );
}
