import type { RejectionReviewChecks } from '../../../../shared/rejectionReview';
import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';
import { checkCards } from './model/reviewChecks';

/** «Три проверки, которым данные не нужны» (O7c): что сделать, пока откликов меньше порога. */
export function ReviewChecks({ checks }: { readonly checks: RejectionReviewChecks }) {
  const cards = checkCards(checks);
  return (
    <>
      <h3 className="mod-title">Три проверки, которым данные не нужны</h3>
      <ol className="rec-list">
        {cards.map((card, index) => (
          <li className={index === 0 ? 'rec-card is-next' : 'rec-card'} key={card.key}>
            <span className="rec-n num" aria-hidden="true">
              {index + 1}
            </span>
            <div className="rec-body">
              <h4 className="rec-t">{card.title}</h4>
              <p className="rec-why">{card.why}</p>
              <div className="actions">
                <Link
                  className={index === 0 ? 'btn is-primary' : 'btn'}
                  to={buildNodePath(card.node)}
                >
                  <Icon name={card.icon} />
                  {card.action}
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

/** «Что будет при 20 откликах» (O7c): путь к вакансиям, чтобы набрать данные. */
export function ReviewThreshold({ threshold }: { readonly threshold: number }) {
  return (
    <section className="mod" aria-labelledby="md-next">
      <h3 className="mod-title" id="md-next">
        {`Что будет при ${threshold} откликах`}
      </h3>
      <div className="actions">
        <Link className="btn is-quiet" to={buildNodePath('s07')}>
          <Icon name="vacancies" />
          Посмотреть вакансии
        </Link>
      </div>
    </section>
  );
}
