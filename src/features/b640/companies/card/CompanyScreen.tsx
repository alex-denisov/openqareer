import type { B640CompanyPerson } from '../../../../../shared/b640Companies';
import { ActionDock, Icon, InfoTip, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { useScreenChrome } from '../../shell/ShellContext';
import { companyAbout } from '../format';
import { WantButton } from '../list/CompanyRow';
import { RetryLine } from '../RetryLine';
import { writeToLabel } from '../writeTo';
import { useCompanyWant, type CompanyWant } from '../useCompanyWant';
import { CompanyPeople, type PeopleNext } from './CompanyPeople';
import { CompanyVacancies } from './CompanyVacancies';
import { useCompany, type CompanyCard } from './useCompany';
import { usePeople } from './usePeople';

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
    <div className="co-want">
      <p className="co-wantline" role="status">
        <Icon name="check" />
        <span>В списке «Хочу»</span> ·{' '}
        <button className="row-act" type="button" disabled={busy} onClick={onCancel}>
          Отменить
        </button>
      </p>
    </div>
  );
}

interface HeadProps {
  readonly card: LoadedCard;
  readonly want: CompanyWant;
  /** Знакомый из круга 1: главное действие шапки — написать ему. */
  readonly known: B640CompanyPerson | undefined;
}

/** «Написать <имя>» знакомому из круга 1 и «Хочу в компанию», пока компании нет в списке «Хочу». */
function HeadActions({ card, want, known }: HeadProps) {
  const { company } = card.details;
  return (
    <>
      {known ? (
        <Link className="btn is-primary" to={buildNodePath('o02', { responseId: known.vacancyId })}>
          <Icon name="send" />
          {writeToLabel(known.name ?? '')}
        </Link>
      ) : null}
      {company.want ? null : (
        <WantButton
          company={company}
          busy={want.busyKey === company.key}
          small={false}
          onWant={(target) => void want.toggle(target)}
        />
      )}
    </>
  );
}

/** На 1440 действия шапки справа от названия, на 390 — в закреплённой панели над навигацией.
 *  Рендерятся оба блока, ширину переключает CSS: так шапка не зависит от того, успел ли сработать медиазапрос в JS. */
function Head(props: HeadProps) {
  const { company } = props.card.details;
  const facts = [company.location, company.industry].filter(Boolean).join(' · ');
  const about = companyAbout(company);
  const hasActions = Boolean(props.known) || !company.want;
  return (
    <section className="lead co-head" aria-labelledby="co-name">
      <h2 className="lead-title is-long" id="co-name">
        {company.name}
        {about ? <InfoTip label="О компании" text={about} /> : null}
      </h2>
      {facts ? <p className="lead-text">{facts}</p> : null}
      {hasActions ? (
        <div className="actions co-head-acts">
          <HeadActions {...props} />
        </div>
      ) : null}
      {hasActions ? <ActionDock primary={<HeadActions {...props} />} /> : null}
      {props.want.failed ? <RetryLine text="Не удалось сохранить отметку" onRetry={props.want.retry} /> : null}
    </section>
  );
}

function peopleNext(card: LoadedCard): PeopleNext {
  const only = card.vacancies[0];
  if (card.details.roleTotal === 1 && only) return { kind: 'vacancy', vacancyId: only.cluster.id };
  if (card.details.roleTotal > 1) return { kind: 'vacancies' };
  return { kind: 'recruiter', company: card.details.company.name };
}

function Loaded({ card, companyId }: { readonly card: LoadedCard; readonly companyId: string }) {
  const { company } = card.details;
  const want = useCompanyWant(card.markWant);
  const people = usePeople(companyId, true);
  return (
    <>
      {company.want ? (
        <WantLine
          busy={want.busyKey === company.key}
          onCancel={() => void want.toggle({ key: company.key, name: company.name, want: true })}
        />
      ) : null}
      <div className="col col-wide">
        <Head card={card} want={want} known={people.people.find((person) => person.circle === 1 && person.name)} />
        <CompanyVacancies
          vacancies={card.vacancies}
          total={card.details.roleTotal}
          others={card.details.otherVacancies}
          othersTotal={card.details.otherTotal}
          applications={card.details.applications}
          moreBusy={card.moreBusy}
          moreFailed={card.moreFailed}
          onMore={() => void card.loadMore()}
        />
        <CompanyPeople state={people} next={peopleNext(card)} />
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
    <div className="page" data-b640-node="v10b" data-b640-section="companies">
      {card.load === 'ready' && card.details ? (
        <Loaded card={{ ...card, details: card.details }} companyId={companyId} />
      ) : (
        <Notice card={card} />
      )}
    </div>
  );
}
