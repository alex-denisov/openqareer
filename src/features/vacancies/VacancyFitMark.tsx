import type { VacancyFitView } from '../../../shared/vacancyFit';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { useLatestVacancyFitView } from './vacancyFitViewUpdates';
import { requestVacancySkillCheck } from './vacancyQuizOffer';
import { vacancyFitBoost, vacancyFitMark, vacancyFitSentence } from './vacancyFitModel';

/** «92 %» in the tier colour; colour only supplements the number (28.10 mockup). */
function FitNumber({
  view,
  size,
}: {
  readonly view?: VacancyFitView;
  readonly size?: 'sm' | 'lg';
}) {
  const mark = vacancyFitMark(view);
  const sized = size ? ` is-${size}` : '';
  if (mark.kind === 'number')
    return (
      <span
        className={`vacancy-fit-mark is-${mark.tier}${sized}`}
        role="img"
        aria-label={mark.ariaLabel}
      >
        <b>
          {mark.percent}
          <small>{' %'}</small>
        </b>
      </span>
    );
  return (
    <span
      className={`vacancy-fit-mark is-${mark.kind}${sized}`}
      role="img"
      aria-label={mark.ariaLabel}
    >
      <b>{mark.kind === 'pending' ? 'считаем' : 'нет процента'}</b>
    </span>
  );
}

/** «Совпадение»: the number and «по N треб.» in the 1440 column and in place of the 390 status. */
export function VacancyFitCell({ item }: { readonly item: MatchedVacancyItem }) {
  const view = useLatestVacancyFitView(item.cluster.id, item.explanation.fitView);
  const mark = vacancyFitMark(view);
  return (
    <span className="vacancies-screen-cell vacancies-screen-cell--fit" data-label="Совпадение">
      <FitNumber view={view} />
      {mark.kind === 'pending' ? null : (
        <span className="vacancy-fit-cap" aria-hidden="true">
          {mark.caption}
        </span>
      )}
    </span>
  );
}

/** 28.10 mockup «Считаем»: the percent is counting; the row stays after counted ones. */
function FitCountingBlock({ view }: { readonly view?: VacancyFitView }) {
  return (
    <section className="vacancy-fit-block" aria-label="Совпадение считается">
      <FitNumber view={view} size="lg" />
      <div className="vacancy-fit-block-text">
        <h3>Совпадение считается</h3>
        <p>
          Процент появится в течение минуты. Пока он считается, вакансия стоит после посчитанных.
        </p>
      </div>
    </section>
  );
}

const NONE_TEXT: Readonly<Record<string, { readonly title: string; readonly text: string }>> = {
  'нет профиля': {
    title: 'Нет профиля',
    text: 'Без профиля процента нет. Загрузите резюме или подключите LinkedIn — проценты посчитаются для всей подборки.',
  },
  'мало требований': {
    title: 'Мало требований',
    text: 'В тексте вакансии меньше 3 требований: процент не считаем, чтобы не показать «100 %» по одному пункту. Строка идёт в конце.',
  },
};

/** 29.10 mockup states «Мало требований» and «Нет профиля»; the old «Соответствие» block is gone. */
function FitNoneBlock({
  view,
  caption,
}: {
  readonly view?: VacancyFitView;
  readonly caption: string;
}) {
  const copy = NONE_TEXT[caption] ?? NONE_TEXT['мало требований'];
  return (
    <section className="vacancy-fit-block" aria-label={copy.title}>
      <FitNumber view={view} size="lg" />
      <div className="vacancy-fit-block-text">
        <h3>{copy.title}</h3>
        <p>{copy.text}</p>
      </div>
    </section>
  );
}

/** First block of the expanded vacancy and the 390 push: the number and why it is that. */
export function VacancyFitBlock({
  cluster,
  view: initialView,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly view?: VacancyFitView;
}) {
  const view = useLatestVacancyFitView(cluster.id, initialView);
  const mark = vacancyFitMark(view);
  if (mark.kind === 'pending') return <FitCountingBlock view={view} />;
  if (mark.kind === 'none') return <FitNoneBlock view={view} caption={mark.caption} />;
  const sentence = vacancyFitSentence(view);
  const boost = vacancyFitBoost(view);
  return (
    <section className="vacancy-fit-block" aria-label={`Совпадение ${mark.percent} %`}>
      <FitNumber view={view} size="lg" />
      <div className="vacancy-fit-block-text">
        <h3>Совпадение {mark.percent}&nbsp;%</h3>
        {sentence ? <p>{sentence}</p> : null}
      </div>
      {boost ? (
        <button
          type="button"
          className="vac-sm vacancy-fit-boost"
          onClick={() =>
            requestVacancySkillCheck({
              vacancyId: cluster.id,
              roleTitle: cluster.canonicalTitle,
              skills: boost.skills,
            })
          }
        >
          {boost.label}
        </button>
      ) : null}
    </section>
  );
}
