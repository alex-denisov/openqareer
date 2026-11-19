import type { CandidateCompanyRecruiter } from '../../../../../shared/candidateCompany';
import { Icon, InfoTip, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { shortDate } from '../format';

const CIRCLES_TIP =
  'Круг 1 — вы знакомы, круг 2 — вас может представить общий контакт, круг 3 — холодный отклик.';

function sourceLine(recruiter: CandidateCompanyRecruiter): string {
  const date = shortDate(recruiter.sourceDate);
  const where = recruiter.source === 'vacancy' ? `рекрутер вакансии на ${recruiter.sourceLabel}` : recruiter.sourceLabel;
  return date ? `${where}, ${date}` : where;
}

/** Один человек — одна строка, даже если он рекрутер нескольких вакансий компании. */
export function uniquePeople(recruiters: readonly CandidateCompanyRecruiter[]): CandidateCompanyRecruiter[] {
  const seen = new Set<string>();
  return recruiters.filter((recruiter) => {
    const key = recruiter.fullName.trim().toLocaleLowerCase('ru-RU');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** «Люди компании из вашей сети»: пока известны рекрутеры вакансий — это круг 3. */
export function CompanyPeople({ recruiters: all }: { readonly recruiters: readonly CandidateCompanyRecruiter[] }) {
  const recruiters = uniquePeople(all);
  return (
    <section className="mod" aria-labelledby="co-ppl">
      <h3 className="mod-title" id="co-ppl">
        Люди компании из вашей сети
        <InfoTip label="Что значат круги" text={CIRCLES_TIP} />
      </h3>
      {recruiters.length === 0 ? (
        <p className="row-sub" role="status">Знакомых в компании не нашли</p>
      ) : (
        <ul className="rows co-people">
          {recruiters.map((recruiter) => (
            <li className="row co-person" key={recruiter.id}>
              <div>
                <div className="row-title">{recruiter.fullName}</div>
                {recruiter.roleTitle ? <div className="row-sub">{recruiter.roleTitle}</div> : null}
                <div className="row-sub co-src">
                  <Icon name="path" />
                  {sourceLine(recruiter)}
                </div>
              </div>
              <span className="tag">круг 3</span>
              <Link className="btn" to={buildNodePath('o02', { responseId: recruiter.vacancyId })}>
                Холодный отклик
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
