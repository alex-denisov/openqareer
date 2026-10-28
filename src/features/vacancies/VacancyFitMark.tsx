import type { ReactNode } from 'react';
import type { VacancyFitView } from '../../../shared/vacancyFit';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { useLatestVacancyFitView } from './vacancyFitViewUpdates';
import { useFocusCheckStartable } from './VacancyQuizProposal';
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

/** First block of the expanded vacancy and the 390 push: the number and why it is that. */
export function VacancyFitBlock({
  cluster,
  view: initialView,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly view?: VacancyFitView;
}) {
  const view = useLatestVacancyFitView(cluster.id, initialView);
  const startable = useFocusCheckStartable();
  const mark = vacancyFitMark(view);
  if (mark.kind !== 'number') return null;
  const sentence = vacancyFitSentence(view);
  const boost = vacancyFitBoost(view, startable === true);
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

const LEGEND = [
  ['hi', '80–100'],
  ['good', '60–79'],
  ['mid', '40–59'],
  ['low', 'до 40'],
] as const;

/** The server formula in one line (server/domain/vacancyFit.ts). */
export const FIT_FORMULA_TEXT =
  'Процент — доля требований вакансии, которые подтверждаются вашим профилем. ' +
  'Каждая неподтверждённая роль, регион или право на работу снижает потолок на 10 пунктов.';

/** Above the column header: order, 4-dot legend and the formula (28.10 mockup). */
export function VacancyFitBar({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="vacancy-fit-bar">
      {children}
      <span className="vacancy-fit-legend" role="list" aria-label="Шкала совпадения">
        {LEGEND.map(([tier, label]) => (
          <span key={tier} role="listitem" className={`vacancy-fit-key is-${tier}`}>
            {label}
          </span>
        ))}
      </span>
      <p className="vacancy-fit-how">{FIT_FORMULA_TEXT}</p>
    </div>
  );
}
