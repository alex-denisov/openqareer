import React from 'react';
import { Check } from '@phosphor-icons/react';
import { SUPPORT_EMAIL } from './publicSiteContent';

const POINTS = [
  'Разовая оплата 150–300 тыс. ₽ — сумма зависит от уровня и рынка',
  'Знакомство с работодателем через связи, без гарантии результата',
  'Всё из Max на время поиска',
] as const;

const FIELDS = [
  { id: 'ex-n', label: 'Имя', name: 'Имя', autoComplete: 'name', half: true },
  { id: 'ex-c', label: 'Telegram или телефон', name: 'Связь', half: true },
  {
    id: 'ex-r',
    label: 'Какую позицию ищете',
    name: 'Позиция',
    placeholder: 'Например: финансовый директор, производство',
  },
  { id: 'ex-l', label: 'Профиль LinkedIn или hh.ru', name: 'Профиль', inputMode: 'url' as const },
] as const;

/** The request goes to support by mail: the public site has no account to attach it to. */
function mailtoRequest(form: HTMLFormElement): string {
  const data = new FormData(form);
  const body = FIELDS.map((field) => `${field.name}: ${String(data.get(field.id) ?? '')}`).join(
    '\n',
  );
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Заявка на Executive')}&body=${encodeURIComponent(body)}`;
}

function Field({ field }: Readonly<{ field: (typeof FIELDS)[number] }>) {
  return (
    <div className="pg-field">
      <label htmlFor={field.id}>{field.label}</label>
      <input
        id={field.id}
        name={field.id}
        autoComplete={'autoComplete' in field ? field.autoComplete : undefined}
        placeholder={'placeholder' in field ? field.placeholder : undefined}
        inputMode={'inputMode' in field ? field.inputMode : undefined}
      />
    </div>
  );
}

function Consent() {
  return (
    <label className="pg-small pg-consent">
      <input type="checkbox" required />
      <span>
        Согласен на обработку персональных данных по{' '}
        <a className="pg-link" href="/legal/consent">
          согласию
        </a>
      </span>
    </label>
  );
}

export function ExecutiveRequest() {
  const send = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    window.location.href = mailtoRequest(event.currentTarget);
  };
  return (
    <section className="pg-sec" id="executive-form">
      <div className="ps-wrap">
        <div className="pg-exec">
          <div className="pg-exec-l">
            <span className="pg-label">Executive</span>
            <h2>Для руководителей, чья следующая позиция не публикуется</h2>
            <p>
              Многие позиции уровня директора закрываются без публикации. Команда openqareer выходит
              на них через рекрутеров и связи.
            </p>
            <ul>
              {POINTS.map((point) => (
                <li key={point}>
                  <Check size={16} className="pg-icon" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <form onSubmit={send} aria-labelledby="ex-h">
            <b id="ex-h">Заявка на Executive</b>
            <div className="pg-two">
              <Field field={FIELDS[0]} />
              <Field field={FIELDS[1]} />
            </div>
            <Field field={FIELDS[2]} />
            <Field field={FIELDS[3]} />
            <Consent />
            <button className="pg-btn is-primary is-lg" type="submit">
              Отправить заявку
            </button>
            <p className="pg-small">Ответим в течение одного рабочего дня.</p>
          </form>
        </div>
      </div>
    </section>
  );
}
