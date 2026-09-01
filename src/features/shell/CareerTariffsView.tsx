import { useState } from 'react';
import { ChatCircleDots, Check } from '@phosphor-icons/react';
import { CURRENT_PLAN, tariffPackages as packages } from './tariffPackages';


export function CareerTariffsView({
  onOpenCoach,
}: {
  onOpenCoach: () => void;
}) {
  // Экран открывается на плане, который у кандидата действительно есть.
  // Раньше он открывался на «Настройке поиска» — платном тарифе, который никто
  // не подключал и подключить нельзя: оплаты в продукте нет.
  const [selected, setSelected] = useState<(typeof packages)[number]['id']>(
    CURRENT_PLAN.id,
  );
  const plan = packages.find((item) => item.id === selected) ?? packages[0];
  return (
    <div className="career-view career-simple-view">
      <header className="career-view-heading">
        <div>
          <p className="career-eyebrow">Тарифы</p>
          <h1>Сколько делать за вас</h1>
          <p className="career-plan-payment-state">
            Оплата не подключена: сейчас у всех план «{CURRENT_PLAN.name}».
          </p>
        </div>
        <button
          className="career-icon-text-button"
          type="button"
          onClick={onOpenCoach}
        >
          <ChatCircleDots size={18} aria-hidden="true" />
          Помочь выбрать
        </button>
      </header>
      <div className="career-plan-layout">
        <div className="career-plan-picker" aria-label="Тарифы">
          {packages.map((item) => (
            <button
              key={item.id}
              className={selected === item.id ? 'is-selected' : ''}
              type="button"
              aria-pressed={selected === item.id}
              onClick={() => setSelected(item.id)}
            >
              <span>
                {item.name}
                {item.id === CURRENT_PLAN.id ? (
                  <em className="career-plan-current">Ваш план сейчас</em>
                ) : null}
              </span>
              <strong>{item.price}</strong>
              <small>{item.status} · {item.time}</small>
            </button>
          ))}
        </div>
        <section className="career-plan-detail" aria-live="polite">
          <div>
            <p className="career-plan-time">{plan.status} · {plan.time}</p>
            <h2>{plan.name}</h2>
            <strong className="career-plan-price">{plan.price}</strong>
          </div>
          <ul>
            {plan.points.map((point) => (
              <li key={point}>
                <Check size={17} weight="bold" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
          <p className="career-plan-note">{plan.note}</p>
          {plan.id === CURRENT_PLAN.id ? (
            <p className="career-plan-standing">
              Это ваш план сейчас. Всё перечисленное работает без оплаты.
            </p>
          ) : (
            <p className="career-plan-standing">
              Оплата не подключена — перейти на этот план пока нельзя. Мы не
              берём деньги за то, чего ещё не умеем делать.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
