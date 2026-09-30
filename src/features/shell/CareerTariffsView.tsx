import { useState } from 'react';
import { ChatCircleDots, Check } from '@phosphor-icons/react';
import { CURRENT_PLAN, tariffPackages as packages } from './tariffPackages';
import { usePlanRequests, type PlanRequestState } from './planRequestApi';
import { PageHeader } from './PageHeader';

export function CareerTariffsView({ onOpenCoach }: { onOpenCoach: () => void }) {
  // Экран открывается на плане, который у кандидата действительно есть.
  // Раньше он открывался на «Настройке поиска» — платном тарифе, который никто
  // не подключал и подключить нельзя: оплаты в продукте нет.
  const [selected, setSelected] = useState<(typeof packages)[number]['id']>(CURRENT_PLAN.id);
  const requests = usePlanRequests();
  const plan = packages.find((item) => item.id === selected) ?? packages[0];
  return (
    <div className="career-view career-simple-view">
      <PageHeader
        kicker="Тарифы"
        title="Сколько делать за вас"
        description={`Оплата не подключена: сейчас у всех план «${CURRENT_PLAN.name}».`}
        right={
          <button className="career-icon-text-button" type="button" onClick={onOpenCoach}>
            <ChatCircleDots size={18} aria-hidden="true" />
            Помочь выбрать
          </button>
        }
      />
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
              <small>
                {item.time ? `${item.status} · ${item.time}` : item.status}
              </small>
            </button>
          ))}
        </div>
        <section className="career-plan-detail" aria-live="polite">
          <div>
            <p className="career-plan-time">
              {plan.time ? `${plan.status} · ${plan.time}` : plan.status}
            </p>
            <h2>{plan.name}</h2>
            <strong className="career-plan-price">{plan.price}</strong>
          </div>
          <ul>
            {plan.points.map((point) => (
              <li key={point}>
                {plan.id === 'auto' ? (
                  <span className="career-plan-point-dot" aria-hidden="true" />
                ) : (
                  <Check size={17} weight="bold" aria-hidden="true" />
                )}
                {point}
              </li>
            ))}
          </ul>
          <p className="career-plan-note">{plan.note}</p>
          {plan.id === CURRENT_PLAN.id ? (
            <p className="career-plan-standing">
              Это ваш план сейчас. Всё перечисленное работает без оплаты.
            </p>
          ) : plan.id === 'setup' ? (
            <PlanRequestAction
              state={requests.states.consultant ?? 'idle'}
              date={requests.dates.consultant}
              onSend={() => requests.send('consultant')}
            />
          ) : (
            <p className="career-plan-standing">
              Оплата не подключена — перейти на этот план пока нельзя. Мы не берём деньги за то,
              чего ещё не умеем делать.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function formatDayMonth(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d);
}

/** The request is shown as sent only after the server stored it (B266). */
function PlanRequestAction({
  state,
  date,
  onSend,
}: {
  state: PlanRequestState;
  date?: string;
  onSend: () => void;
}) {
  if (state === 'sent') {
    const formattedDate = date ? formatDayMonth(date) : null;
    return (
      <p className="career-plan-standing" role="status">
        {formattedDate
          ? `Заявка отправлена ${formattedDate} — свяжемся в течение рабочего дня`
          : 'Заявка уже отправлена'}
      </p>
    );
  }
  return (
    <>
      <button
        className="career-primary-button"
        type="button"
        disabled={state === 'sending'}
        onClick={onSend}
      >
        {state === 'sending' ? 'Отправляем…' : 'Оставить заявку'}
      </button>
      {state === 'failed' ? (
        <p className="career-plan-standing" role="alert">
          Заявка не ушла — проверьте соединение и попробуйте ещё раз.
        </p>
      ) : null}
    </>
  );
}
