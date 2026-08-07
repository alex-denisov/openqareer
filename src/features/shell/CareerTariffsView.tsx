import { useState } from 'react';
import { ChatCircleDots, Check } from '@phosphor-icons/react';

const packages = [
  {
    id: 'free',
    name: 'Диагностика',
    price: '0 ₽',
    time: 'без срока',
    points: ['Карьерная картина', 'Гипотезы ролей', 'Первое действие'],
  },
  {
    id: 'setup',
    name: 'Настройка поиска',
    price: 'от 4 900 ₽',
    time: '30 дней',
    points: ['Материалы под роль', 'Целевые компании', 'Старт кампании'],
  },
  {
    id: 'auto',
    name: 'Автопилот',
    price: 'от 12 900 ₽',
    time: '90 дней',
    points: [
      'Поиск и приоритизация',
      'Отклики и outreach',
      'Ответы и интервью',
    ],
  },
] as const;

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
              <small>{item.time}</small>
            </button>
          ))}
        </div>
        <section className="career-plan-detail" aria-live="polite">
          <div>
            <p className="career-plan-time">{plan.time}</p>
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
          <p className="career-plan-note">
            Оплата за объём и срок работы, не за обещание оффера. Подключение
            оплаты появится после проверки спроса.
          </p>
        </section>
      </div>
    </div>
  );
}
