import { useState } from 'react';
import { InfoTip, StatusLine } from '../kit';
import { saveLowerIncome, type LowerIncomeAnswer, type ProfessionWage } from './professionPathApi';
import { formatFork, incomeShift } from './professionPathModel';

const ANSWERS: ReadonlyArray<readonly [LowerIncomeAnswer, string]> = [
  ['yes', 'Да'],
  ['no', 'Нет'],
  ['depends', 'Зависит'],
];

const dateLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

function LowerIncomeAsk(props: {
  readonly range: string;
  readonly initial: LowerIncomeAnswer | null;
}) {
  const [answer, setAnswer] = useState(props.initial);
  const [failed, setFailed] = useState(false);
  const choose = async (next: LowerIncomeAnswer) => {
    const before = answer;
    setAnswer(next);
    setFailed(false);
    try {
      setAnswer(await saveLowerIncome(next));
    } catch {
      setAnswer(before);
      setFailed(true);
    }
  };
  return (
    <fieldset className="optin s11-ask">
      <legend>Вы готовы к доходу на {props.range} ниже?</legend>
      <div className="chips" role="group" aria-label="Ответ">
        {ANSWERS.map(([value, label]) => (
          <button
            className="chip"
            type="button"
            key={value}
            aria-pressed={answer === value}
            onClick={() => void choose(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {failed ? <StatusLine state="err" text="Ответ не сохранился. Попробуйте ещё раз." /> : null}
    </fieldset>
  );
}

function Comparison(props: {
  readonly wage: Extract<ProfessionWage, { state: 'ready' }>;
  readonly current: number;
  readonly answer: LowerIncomeAnswer | null;
}) {
  const shift = incomeShift(props.wage.min, props.wage.max, props.current);
  const now = `${Math.round(props.current / 1000)} тыс. ₽`;
  const range = shift.kind === 'same' ? '' : `${shift.from}–${shift.to} %`;
  const text =
    shift.kind === 'same'
      ? `Примерно столько же, сколько сейчас: ${now} на руки`
      : `Это на ${range} ${shift.kind === 'lower' ? 'меньше' : 'больше'}, чем сейчас: ${now} на руки`;
  return (
    <>
      <p className="mod-text">
        {text}
        <InfoTip label="Откуда доход" text="Текущий доход — из профиля." />
      </p>
      {shift.kind === 'lower' ? <LowerIncomeAsk range={range} initial={props.answer} /> : null}
    </>
  );
}

/** «Доход при переходе»: вилка профессии; сравнение — только если доход указан в профиле. */
export function ProfessionMoney(props: {
  readonly wage: ProfessionWage;
  readonly current: number | null;
  readonly answer: LowerIncomeAnswer | null;
}) {
  const { wage } = props;
  const tip =
    wage.state === 'ready'
      ? `Вилка — по ${wage.sampleSize} вакансиям с указанной зарплатой за 30 дней, на ${dateLabel(wage.observedAt)}.`
      : 'Вилку показываем, когда вакансий с указанной зарплатой хватает для расчёта.';
  return (
    <section className="mod" aria-labelledby="money-title">
      <h3 className="mod-title" id="money-title">
        Доход при переходе
        <InfoTip label="Как посчитано" text={tip} />
      </h3>
      {wage.state === 'ready' ? (
        <>
          <p className="s11-metric num">{formatFork(wage.min, wage.max)}</p>
          {props.current ? (
            <Comparison wage={wage} current={props.current} answer={props.answer} />
          ) : null}
        </>
      ) : (
        <p className="mod-text">Мало данных: вакансий с зарплатой {wage.sampleSize}</p>
      )}
    </section>
  );
}
