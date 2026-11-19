import type { CandidateCompanyVacancy } from '../../../../../shared/candidateCompany';
import { Button, Icon, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { formatCount, shortDate } from '../format';

export interface CompanyVacanciesProps {
  readonly vacancies: readonly CandidateCompanyVacancy[];
  readonly total: number;
  readonly moreBusy: boolean;
  readonly moreFailed: boolean;
  readonly onMore: () => void;
}

const PAGE = 20;

function subLine(vacancy: CandidateCompanyVacancy): string {
  return [vacancy.location, vacancy.sourceName, shortDate(vacancy.sourceDate)].filter(Boolean).join(' · ');
}

/** «Вакансии по вашим ролям»: вакансии подборки этой компании, отклик из строки. */
export function CompanyVacancies({ vacancies, total, moreBusy, moreFailed, onMore }: CompanyVacanciesProps) {
  const left = total - vacancies.length;
  return (
    <section className="mod" aria-labelledby="co-vac">
      <h3 className="mod-title" id="co-vac">
        Вакансии по вашим ролям · <span className="num">{formatCount(total)}</span>
      </h3>
      {vacancies.length === 0 ? (
        <p className="row-sub" role="status">Подходящих вакансий сейчас нет</p>
      ) : (
        <ul className="rows co-vlist">
          {vacancies.map((vacancy) => (
            <li className="row co-vrow" key={vacancy.id}>
              <div className="co-vmain">
                <Link className="row-title" to={buildNodePath('v04', { vacancyId: vacancy.id })}>
                  {vacancy.title}
                </Link>
                <div className="row-sub num">{subLine(vacancy)}</div>
              </div>
              <Link className="btn" to={buildNodePath('o02', { responseId: vacancy.id })}>
                <Icon name="responses" />
                Откликнуться
              </Link>
            </li>
          ))}
        </ul>
      )}
      {left > 0 ? (
        <div className="vl-foot">
          <Button icon="down" busy={moreBusy} onClick={onMore}>
            <span>{`Показать ещё ${Math.min(PAGE, left)}`}</span>
          </Button>
        </div>
      ) : null}
      {moreFailed ? <StatusLine state="err" text="Не удалось загрузить. Нажмите ещё раз." /> : null}
    </section>
  );
}
