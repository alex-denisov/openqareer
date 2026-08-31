import { useState } from 'react';
import { ChatCircleDots, Check } from '@phosphor-icons/react';
import { tariffPackages as packages } from './tariffPackages';


export function CareerTariffsView({
  onOpenCoach,
}: {
  onOpenCoach: () => void;
}) {
  const [selected, setSelected] =
    useState<(typeof packages)[number]['id']>('setup');
  const plan = packages.find((item) => item.id === selected) ?? packages[0];
  return (
    <div className="career-view career-simple-view">
      <header className="career-view-heading">
        <div>
          <p className="career-eyebrow">Тарифы</p>
          <h1>Сколько делать за вас</h1>
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
              <span>{item.name}</span>
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
        </section>
      </div>
    </div>
  );
}
