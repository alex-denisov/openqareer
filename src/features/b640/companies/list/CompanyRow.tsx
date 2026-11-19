import type { CandidateCompanyOpportunity } from '../../../../../shared/candidateCompany';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { companyInitial, formatCount, vacancyWord } from '../format';
import type { WantTarget } from '../useCompanyWant';

export interface CompanyRowProps {
  readonly company: CandidateCompanyOpportunity;
  readonly busy: boolean;
  readonly onWant: (target: WantTarget) => void;
}

function Contacts({ count }: { readonly count: number | null }) {
  if (count === null) return <span className="dim">—</span>;
  if (count === 0) return <span className="dim">нет знакомых</span>;
  return (
    <>
      <span className="num">{formatCount(count)}</span>&nbsp;в сети
    </>
  );
}

/** Кнопка «Хочу в компанию»; отмеченная — «Хочу» с галочкой. */
export function WantButton({ company, busy, onWant, small = true }: CompanyRowProps & { readonly small?: boolean }) {
  const classes = ['btn', small ? 'is-sm' : '', 'co-want', company.want ? 'is-on' : ''].filter(Boolean).join(' ');
  return (
    <button
      className={classes}
      type="button"
      aria-pressed={company.want}
      aria-busy={busy || undefined}
      disabled={busy}
      aria-label={`Хочу в компанию: ${company.name}`}
      onClick={() => onWant({ key: company.key, name: company.name, want: company.want })}
    >
      <Icon name={company.want ? 'check' : 'building'} />
      <span>{company.want ? 'Хочу' : 'Хочу в компанию'}</span>
    </button>
  );
}

/** Строка таблицы «Компании и люди» (`tr.co-row` макета v10). */
export function CompanyRow({ company, busy, onWant }: CompanyRowProps) {
  return (
    <tr className="co-row">
      <th scope="row" className="co-c co-co">
        <div className="co-name">
          <span className="co-ava" aria-hidden="true">
            {companyInitial(company.name)}
          </span>
          <Link className="co-nm" to={buildNodePath('v10b', { companyId: company.key })}>
            <span className="co-nm-t">{company.name}</span>
            {company.location ? <small>{company.location}</small> : null}
          </Link>
        </div>
      </th>
      <td className="co-c co-vac" data-l="Вакансий по вашим ролям">
        <span className="num">{formatCount(company.vacancyCount)}</span>&nbsp;{vacancyWord(company.vacancyCount)}
      </td>
      <td className="co-c co-net" data-l="Знакомые">
        <Contacts count={company.contactsCount} />
      </td>
      <td className="co-c co-act">
        <WantButton company={company} busy={busy} onWant={onWant} />
      </td>
    </tr>
  );
}
