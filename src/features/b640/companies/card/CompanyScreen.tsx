import { Icon, InfoTip, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { useScreenChrome } from '../../shell/ShellContext';
import { companyAbout } from '../format';
import { WantButton } from '../list/CompanyRow';
import { RetryLine } from '../RetryLine';
import { useCompanyWant, type CompanyWant } from '../useCompanyWant';
import { CompanyPeople } from './CompanyPeople';
import { CompanyVacancies } from './CompanyVacancies';
import { useCompany, type CompanyCard } from './useCompany';

function Notice({ card }: { readonly card: CompanyCard }) {
  if (card.load === 'loading') return <StatusLine state="wait" text="Загружаем компанию…" />;
  if (card.load === 'missing') {
    return (
      <div className="vl-empty" role="status">
        <p className="vl-empty-t">Этой компании нет в вашей подборке</p>
        <Link className="btn" to={buildNodePath('v10')}>
          К списку компаний
        </Link>
      </div>
    );
  }
  return <RetryLine text="Не удалось загрузить компанию" onRetry={card.retry} />;
}

type LoadedCard = CompanyCard & { readonly details: NonNullable<CompanyCard['details']> };

function WantLine({ busy, onCancel }: { readonly busy: boolean; readonly onCancel: () => void }) {
  return (
    <p className="co-wantline" role="status">
      <Icon name="check" />
      <span>В списке «Хочу»</span> ·{' '}
      <button className="row-act" type="button" disabled={busy} onClick={onCancel}>
        Отменить
      </button>
    </p>
  );
}

function Head({ card, want }: { readonly card: LoadedCard; readonly want: CompanyWant }) {
  const { company } = card.details;
  const facts = [company.location, company.industry].filter(Boolean).join(' · ');
  const about = companyAbout(company);
  return (
    <section className="lead co-head" aria-labelledby="co-name">
      <h2 className="lead-title is-long" id="co-name">
        {company.name}
        {about ? <InfoTip label="О компании" text={about} /> : null}
      </h2>
      {facts ? <p className="lead-text">{facts}</p> : null}
      {company.want ? null : (
        <div className="actions">
          <WantButton
            company={company}
            busy={want.busyKey === company.key}
            small={false}
            onWant={(target) => void want.toggle(target)}
          />
        </div>
      )}
      {want.failed ? <RetryLine text="Не удалось сохранить отметку" onRetry={want.retry} /> : null}
    </section>
  );
}

function Loaded({ card }: { readonly card: LoadedCard }) {
  const { company, totalVacancies } = card.details;
  const want = useCompanyWant(card.markWant);
  return (
    <>
      {company.want ? (
        <WantLine
          busy={want.busyKey === company.key}
          onCancel={() => void want.toggle({ key: company.key, name: company.name, want: true })}
        />
      ) : null}
      <div className="col col-wide">
        <Head card={card} want={want} />
        <CompanyVacancies
          vacancies={card.vacancies}
          total={totalVacancies}
          moreBusy={card.moreBusy}
          moreFailed={card.moreFailed}
          onMore={() => void card.loadMore()}
        />
        <CompanyPeople recruiters={company.recruiters} />
      </div>
    </>
  );
}

/** Узел v10b: карточка компании — отметка «Хочу», вакансии по ролям и люди компании. */
export function CompanyScreen({ companyId }: { readonly companyId: string }) {
  const card = useCompany(companyId);
  const name = card.details?.company.name;
  useScreenChrome({ title: name, crumb: name });
  return (
    <div className="page" data-b640-node="v10b" data-b640-section="vacancies">
      {card.load === 'ready' && card.details ? (
        <Loaded card={{ ...card, details: card.details }} />
      ) : (
        <Notice card={card} />
      )}
    </div>
  );
}
