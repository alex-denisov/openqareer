import React from 'react';
import { Check } from '@phosphor-icons/react';
import { DocCrumbs, PublicDocShell, type DocPageProps } from './PublicDocShell';
import { TariffComparison } from './TariffComparison';
import { ExecutiveRequest } from './ExecutiveRequest';
import {
  PAYMENT_FAQ,
  PLAN_CARDS,
  REPLY_MODES,
  TARIFFS_TITLE,
  type PlanCard,
} from './tariffsPageContent';
import { tariffsStructuredData } from './publicSiteStructuredData';

const PROMOTED = PLAN_CARDS.findIndex((card) => card.recommended);

function Plan({ card }: Readonly<{ card: PlanCard }>) {
  const exec = card.id === 'exec';
  return (
    <div className={`pg-tc${card.recommended ? ' is-hl' : ''}`} id={exec ? 'executive' : undefined}>
      <span className="pg-nm">
        {card.name}
        {card.recommended ? <span className="pg-chip is-blue">Рекомендуем</span> : null}
      </span>
      <span className="pg-who">{card.who}</span>
      <span className="pg-pr">{card.price}</span>
      <span className="pg-tm">{card.term}</span>
      <ul>
        {card.lead ? <li className="is-all">{card.lead}</li> : null}
        {card.points.map((point) => (
          <li key={point}>
            <Check size={16} className="pg-icon" aria-hidden="true" />
            {point}
          </li>
        ))}
      </ul>
      {card.hint ? (
        <a className="pg-link pg-tr" href={card.hint.href}>
          {card.hint.text}
        </a>
      ) : null}
      <a className={`pg-btn${card.recommended ? ' is-primary' : ''}`} href={card.cta.href}>
        {card.cta.label}
      </a>
    </div>
  );
}

/** Cards swipe sideways on a phone, Pro first, with one dot per card. */
function PlanRow() {
  const row = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(PROMOTED);
  React.useEffect(() => {
    const node = row.current;
    if (!node || !window.matchMedia('(max-width: 760px)').matches) return;
    const cards = Array.from(node.children) as HTMLElement[];
    const first = cards[0]?.offsetLeft ?? 0;
    node.scrollLeft = (cards[PROMOTED]?.offsetLeft ?? 0) - first;
  }, []);
  const onScroll = () => {
    const node = row.current;
    if (!node) return;
    const cards = Array.from(node.children) as HTMLElement[];
    const first = cards[0]?.offsetLeft ?? 0;
    const at = cards.reduce(
      (best, card, index) =>
        Math.abs(card.offsetLeft - first - node.scrollLeft) <
        Math.abs((cards[best]?.offsetLeft ?? 0) - first - node.scrollLeft)
          ? index
          : best,
      0,
    );
    setActive(at);
  };
  return (
    <>
      <div
        className="pg-tp pg-swipe"
        ref={row}
        onScroll={onScroll}
        tabIndex={0}
        role="group"
        aria-label="Тарифы, листаются вбок"
      >
        {PLAN_CARDS.map((card) => (
          <Plan key={card.id} card={card} />
        ))}
      </div>
      <div className="pg-dots" aria-hidden="true">
        {PLAN_CARDS.map((card, index) => (
          <span key={card.id} className={index === active ? 'is-on' : undefined} />
        ))}
      </div>
    </>
  );
}

function ReplyModes() {
  return (
    <div className="pg-modes pg-swipe" tabIndex={0} role="group" aria-label="Режимы, листаются вбок">
      {REPLY_MODES.map((mode) => (
        <div key={mode.title} className={`pg-mode${mode.accent ? ' is-accent' : ''}`}>
          <span className={`pg-chip${mode.accent ? ' is-blue' : ''}`}>{mode.badge}</span>
          <h3>{mode.title}</h3>
          <p>{mode.text}</p>
        </div>
      ))}
    </div>
  );
}

function PaymentFaq() {
  return (
    <div className="pg-faq">
      {PAYMENT_FAQ.map((column) => (
        <div key={column[0]?.q}>
          {column.map((item) => (
            <details key={item.q} className="pg-q" open={item.open}>
              <summary>{item.q}</summary>
              <div className="pg-a">
                {item.a}
                {item.more ? (
                  <>
                    {' '}
                    <a href={item.more.href}>{item.more.text}</a>.
                  </>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      ))}
    </div>
  );
}

export function TariffsPage({ onNavigate, signedIn, isAdmin }: DocPageProps) {
  return (
    <PublicDocShell
      onNavigate={onNavigate}
      signedIn={signedIn}
      isAdmin={isAdmin}
      title={TARIFFS_TITLE}
      current="tariffs"
      structuredData={tariffsStructuredData()}
    >
      <DocCrumbs current="Тарифы" onNavigate={onNavigate} />
      <section className="pg-hero is-short">
        <div className="ps-wrap">
          <span className="pg-eyebrow">Тарифы</span>
          <h1>Выберите, сколько работы отдать openqareer</h1>
          <p className="pg-lead">
            Free показывает ваш рынок. Каждый следующий тариф забирает ещё часть поиска: резюме под
            каждую вакансию, сами отклики, эксперта в решающие моменты.
          </p>
        </div>
      </section>
      <section className="pg-sec is-first">
        <div className="ps-wrap">
          <PlanRow />
          <p className="pg-small pg-free-tools">
            Без регистрации уже доступны:{' '}
            <a className="pg-link" href="/tools/salary-calculator">
              калькулятор зарплаты на руки
            </a>
            ,{' '}
            <a className="pg-link" href="/tools/interview-questions">
              вопросы на собеседовании
            </a>
            ,{' '}
            <a className="pg-link" href="/tools/relocation">
              оценка переезда
            </a>
            .
          </p>
        </div>
      </section>
      <section className="pg-sec">
        <div className="ps-wrap">
          <div className="pg-sh">
            <div>
              <span className="pg-label">Отклики: сколько контроля оставить себе</span>
              <h2>Сколько контроля оставить себе — решаете вы</h2>
            </div>
            <p>
              Три режима: от черновиков до полностью автоматических. Режим можно сменить в любой
              момент; в режимах Pro виден каждый отправленный отклик.
            </p>
          </div>
          <ReplyModes />
        </div>
      </section>
      <TariffComparison />
      <ExecutiveRequest />
      <section className="pg-sec">
        <div className="ps-wrap">
          <div className="pg-sh">
            <div>
              <span className="pg-label">Вопросы</span>
              <h2>Об оплате</h2>
            </div>
          </div>
          <PaymentFaq />
        </div>
      </section>
    </PublicDocShell>
  );
}
