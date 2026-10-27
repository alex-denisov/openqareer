import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calculator,
  FileText,
  Globe,
  ListBullets,
  ShieldCheck,
  Target,
} from '@phosphor-icons/react';
import { getCountryMobilityData } from '../../../shared/countryFit';
import {
  RELOCATION_EXAMPLE,
  estimateRelocation,
  grossForNetMonthly,
  type RelocationAnswers,
} from '../../../shared/countryFit/relocationEstimate';
import type { MobilityRequirement } from '../../../shared/countryFit/types';
import { calculateAnnualPayroll } from '../../../shared/taxCalculators';
import { PublicFooter, PublicHeader } from './PublicSiteChrome';
import { RelocationResults, formatDate, formatMoney } from './RelocationResults';
import { RelocationWizard, countryName } from './RelocationWizard';
import { COUNTRY_CODES } from './countryFitScenario';
import { RELOCATION_PATH, parseRelocationQuery, relocationQuery } from './relocationQuery';

export const RELOCATION_TITLE = 'Куда переехать работать в 2026: пути по странам | openqareer';
export const RELOCATION_DESCRIPTION =
  'Шесть вопросов — и по карточке на каждую выбранную страну: лучший путь переезда, требования с официальным источником и зарплата до налогов для нужной суммы на руки.';

type ThresholdRequirement = Extract<
  MobilityRequirement,
  { readonly amount: number; readonly currency: string }
>;

/** A sourced threshold from `shared/countryFit`; the page never types a number of its own. */
function threshold(
  countryCode: string,
  pathId: string,
  kind: MobilityRequirement['kind'],
): ThresholdRequirement {
  const requirement = getCountryMobilityData(countryCode)
    .scenarios.flatMap(({ paths }) => paths)
    .find(({ id }) => id === pathId)
    ?.requirements.find((item) => item.kind === kind);
  if (!requirement || !('amount' in requirement) || !('currency' in requirement)) {
    throw new Error(`No sourced threshold ${kind} for ${countryCode}/${pathId}`);
  }
  return requirement;
}

function amountOf(requirement: ThresholdRequirement): string {
  return formatMoney(requirement.amount, requirement.currency);
}

export function relocationFacts() {
  const blueCard = threshold('DE', 'eu-blue-card-standard', 'minimum_annual_salary');
  const blueCardReduced = threshold('DE', 'eu-blue-card-it-experience', 'minimum_annual_salary');
  const opportunity = threshold('DE', 'opportunity-card-points', 'minimum_monthly_funds');
  const uaeRemote = threshold('AE', 'virtual-work-residence', 'minimum_remote_income');
  const checkedAt = [blueCard, opportunity, uaeRemote]
    .map(({ source }) => source.retrievedAt)
    .sort()
    .at(-1) as string;
  const germanGross = 5_000;
  const germanNet = Math.round(calculateAnnualPayroll('DE', germanGross * 12).netMonthlyIncome);
  return { blueCard, blueCardReduced, opportunity, uaeRemote, checkedAt, germanGross, germanNet };
}

function readAnswersFromLocation(): RelocationAnswers | undefined {
  if (typeof window === 'undefined') return undefined;
  return parseRelocationQuery(window.location.search);
}

function Hero({
  answers,
  onComplete,
}: {
  readonly answers?: RelocationAnswers;
  readonly onComplete: (a: RelocationAnswers) => void;
}) {
  return (
    <section className="rl-hero">
      <div className="ps-wrap rl-grid">
        <div className="rl-copy-col">
          <span className="rl-eyebrow">Оценка переезда · 6 вопросов · без регистрации</span>
          <h1>В какую страну вы можете переехать работать</h1>
          <p className="rl-lead">
            Не рейтинг «лучших стран», а пути, которые открыты именно вам: с вашим гражданством,
            профессией, языком и семьёй. По официальным правилам 2026 года, у каждой цифры —
            источник.
          </p>
        </div>
        <RelocationWizard initial={answers} onComplete={onComplete} />
      </div>
    </section>
  );
}

function ThreeWays() {
  const facts = relocationFacts();
  return (
    <section className="rl-s" aria-labelledby="rl-ways">
      <div className="ps-wrap">
        <span className="ps-label">Как уезжают работать</span>
        <h2 id="rl-ways">Три способа переехать</h2>
        <div className="rl-paths">
          <div>
            <span className="rl-ib">
              <FileText size={20} aria-hidden="true" />
            </span>
            <span>
              <b>Переезд под оффер компании</b>Работодатель оформляет разрешение. Например, Blue
              Card в Германии — от {amountOf(facts.blueCard)} в год.
            </span>
          </div>
          <div>
            <span className="rl-ib">
              <Target size={20} aria-hidden="true" />
            </span>
            <span>
              <b>Виза для поиска работы</b>Приезжаете и ищете на месте. Например, Chancenkarte в
              Германии — от {amountOf(facts.opportunity)} в месяц на счёте.
            </span>
          </div>
          <div>
            <span className="rl-ib">
              <Globe size={20} aria-hidden="true" />
            </span>
            <span>
              <b>Удалёнка из другой страны</b>Работаете на прежнего работодателя. Например, ОАЭ — от{' '}
              {amountOf(facts.uaeRemote)} дохода в месяц.
            </span>
          </div>
        </div>
        <p className="rl-answer">
          <b>Коротко:</b> Blue Card в Германии — от {amountOf(facts.blueCard)} в год до налогов (
          {amountOf(facts.blueCardReduced)} для IT-специалистов без диплома и отдельных категорий);
          Chancenkarte — {amountOf(facts.opportunity)} в месяц на счёте; удалёнка из ОАЭ — от{' '}
          {amountOf(facts.uaeRemote)} дохода в месяц. Пороги из официальных правил 2026 года,
          проверены {formatDate(facts.checkedAt)}.
        </p>
      </div>
    </section>
  );
}

const AFTER = [
  [
    FileText,
    'Документы',
    'Pro',
    'Что нужно для вашего пути и для семьи, по официальным источникам.',
  ],
  [
    ShieldCheck,
    'Ограничения профиля',
    'Pro',
    'Что в вашем опыте и дипломе мешает и как это обойти.',
  ],
  [
    ListBullets,
    'Вакансии в стране',
    'Free',
    'С релокацией и спонсорством визы, с процентом совпадения с вашим резюме.',
  ],
  [Calculator, 'Экономика переезда', 'Free', 'Зарплата на руки и сравнение двух-трёх стран рядом.'],
] as const;

function AfterSignup() {
  return (
    <section className="rl-s" aria-labelledby="rl-after">
      <div className="ps-wrap">
        <div className="rl-sh">
          <div>
            <span className="ps-label">После регистрации</span>
            <h2 id="rl-after">Полная оценка: от документов до вакансий в стране</h2>
          </div>
          <p>Ответы из шести вопросов уже будут в анкете — начинать заново не придётся.</p>
        </div>
        <div className="rl-after">
          {AFTER.map(([Icon, title, plan, text]) => (
            <div key={title}>
              <span className="rl-ib">
                <Icon size={20} aria-hidden="true" />
              </span>
              <b>{title}</b>
              <span className={plan === 'Pro' ? 'ps-chip is-blue' : 'ps-chip is-ok'}>{plan}</span>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const NEXT_LINKS = [
  ['/vacancies', 'Вакансии в открытом каталоге'],
  ['/tools/country-fit', 'Зарплата на руки в 13 странах'],
  ['/faq', 'Все вопросы о сервисе'],
] as const;

export function relocationFaq(): readonly (readonly [string, string])[] {
  const facts = relocationFacts();
  const countries = COUNTRY_CODES.map(countryName).join(', ');
  const exampleGross = grossForNetMonthly('DE', 3_000);
  return [
    [
      'Это гарантия, что мне дадут визу?',
      'Нет. Мы сверяем ваши ответы с официальными правилами и показываем, какие пути открыты. Решение принимает консульство или миграционная служба страны.',
    ],
    [
      'Какие страны вы оцениваете?',
      `${countries}. Если для страны нет проверенного правила, карточка так и говорит и даёт официальный источник.`,
    ],
    [
      'Какая зарплата нужна для Blue Card в Германии?',
      `${amountOf(facts.blueCard)} в год до налогов по общему правилу и ${amountOf(facts.blueCardReduced)} — для IT-специалистов без диплома и отдельных категорий, которые называют правила.`,
    ],
    [
      'Можно ли переехать без оффера?',
      'Да, по визе для поиска работы — например, Chancenkarte в Германии — или как удалённый работник по визе цифрового кочевника.',
    ],
    [
      'Откуда пороги зарплаты?',
      'С официальных сайтов стран: make-it-in-germany.com, gov.uk, u.ae и других. Под каждой карточкой — ссылка и дата проверки.',
    ],
    [
      'Сколько я буду получать на руки?',
      `Например, с ${formatMoney(facts.germanGross, 'EUR')} до налогов в Германии остаётся ${formatMoney(facts.germanNet, 'EUR')} на руки в месяц (ставки 2026 года), а чтобы получать ${formatMoney(3_000, 'EUR')}, нужно около ${formatMoney(exampleGross ?? 0, 'EUR')} до налогов.`,
    ],
  ];
}

function NextAndFaq() {
  const faq = relocationFaq();
  return (
    <section className="rl-s" aria-labelledby="rl-faq">
      <div className="ps-wrap">
        <nav className="rl-next" aria-label="Что дальше">
          <b>Что дальше</b>
          <div>
            {NEXT_LINKS.map(([href, text]) => (
              <a key={href} href={href}>
                {text} <ArrowRight size={14} aria-hidden="true" />
              </a>
            ))}
          </div>
        </nav>
        <span className="ps-label">Вопросы</span>
        <h2 id="rl-faq">О переезде по работе</h2>
        <div className="ps-faq" itemScope itemType="https://schema.org/FAQPage">
          {faq.map(([question, answer]) => (
            <details
              key={question}
              itemScope
              itemProp="mainEntity"
              itemType="https://schema.org/Question"
            >
              <summary itemProp="name">{question}</summary>
              <div itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
                <p itemProp="text">{answer}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Crumbs() {
  return (
    <nav className="ps-wrap ps-crumbs rl-crumbs" aria-label="Навигационная цепочка">
      <a href="/">Главная</a> / <span aria-current="page">В какую страну переехать</span>
    </nav>
  );
}

/** The answers live in the address: a copied link opens the same estimate. */
function useRelocationAnswers() {
  const [answers, setAnswers] = useState<RelocationAnswers | undefined>(readAnswersFromLocation);
  const shown = answers ?? RELOCATION_EXAMPLE;
  const cards = useMemo(() => estimateRelocation(shown), [shown]);
  useEffect(() => {
    document.title = RELOCATION_TITLE;
  }, []);
  const remember = (next: RelocationAnswers, hash = '') => {
    setAnswers(next);
    window.history.replaceState(
      window.history.state,
      '',
      `${RELOCATION_PATH}${relocationQuery(next)}${hash}`,
    );
  };
  const complete = (next: RelocationAnswers) => {
    remember(next, '#result');
    document.getElementById('result')?.scrollIntoView({ block: 'start' });
  };
  return {
    answers,
    shown,
    cards,
    shareHref: `${RELOCATION_PATH}${relocationQuery(shown)}`,
    remember,
    complete,
  };
}

interface RelocationPageProps {
  readonly onNavigate: (path: string) => void;
  readonly signedIn?: boolean;
  readonly isAdmin?: boolean;
}

export function RelocationPage({
  onNavigate,
  signedIn = false,
  isAdmin = false,
}: RelocationPageProps) {
  const { answers, shown, cards, shareHref, remember, complete } = useRelocationAnswers();
  return (
    <div className="ps rl-page">
      <a className="ps-skip" href="#main">
        К содержимому
      </a>
      <PublicHeader
        onNavigate={onNavigate}
        onLanding={false}
        signedIn={signedIn}
        isAdmin={isAdmin}
      />
      <main id="main" className="ym-hide-content">
        <Crumbs />
        <Hero answers={answers} onComplete={complete} />
        <ThreeWays />
        <RelocationResults
          answers={shown}
          cards={cards}
          isExample={!answers}
          shareHref={shareHref}
          onCountriesChange={(countries) => remember({ ...shown, countries })}
        />
        <AfterSignup />
        <NextAndFaq />
      </main>
      <PublicFooter onNavigate={onNavigate} onLanding={false} signedIn={signedIn} />
    </div>
  );
}
