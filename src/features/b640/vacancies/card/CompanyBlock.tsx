import type { RecruiterContact } from '../../../../../shared/recruiterContact';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { Fold } from './Fold';

export interface CompanyBlockProps {
  readonly item: MatchedVacancyItem;
  readonly recruiter: RecruiterContact | undefined;
  readonly vacancyId: string;
  readonly companyPath: string;
}

/** «О компании»: отрасль, город, рекрутёр. Данных нет — блока нет. */
export function CompanyBlock({ item, recruiter, vacancyId, companyPath }: CompanyBlockProps) {
  const features = item.cluster.companyFeatures;
  const facts = [features?.industry, features?.city].filter((value): value is string => Boolean(value));
  if (facts.length === 0 && !recruiter) return null;
  return (
    <Fold title="О компании" className="v4-about-co" openOnDesktop>
      {facts.length > 0 ? (
        <ul className="v4-co">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : null}
      {recruiter ? (
        <div className="v4-person">
          <p className="v4-person-t">
            <b>{recruiter.fullName}</b>
            {recruiter.roleTitle ? ` · ${recruiter.roleTitle}` : ''}
          </p>
          <Link className="row-act" to={buildNodePath('o02', { responseId: vacancyId })}>
            <Icon name="send" />
            Откликнуться напрямую
          </Link>
        </div>
      ) : null}
      <Link className="row-act v4-co-more" to={companyPath}>
        <Icon name="building" />
        Карточка компании
      </Link>
    </Fold>
  );
}
