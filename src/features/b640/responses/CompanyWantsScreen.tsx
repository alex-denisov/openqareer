import { useCallback, useState, type FormEvent } from 'react';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyWantPage,
  CandidateCompanyWantStageFilter,
} from '../../../../shared/candidateCompany';
import { DEFAULT_COMPANY_WANT_QUERY, getCompanyWantPage } from '../../applications/companyWantsApi';
import { apiErrorMessage } from '../../coach/apiClient';
import { setCandidateCompanyWantByName } from '../../vacancies/candidateCompaniesApi';
import { Button, Icon, InfoTip, Link, ResultLine, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { useAsync, type AsyncState } from './data/useAsync';
import { longDate, pluralRu, type TagTone } from './model/responseRow';

const NAME_MAX = 120;

interface Chip {
  readonly id: CandidateCompanyWantStageFilter;
  readonly label: string;
  readonly count: (page: CandidateCompanyWantPage) => number;
}

const CHIPS: readonly Chip[] = [
  { id: 'all', label: 'Все', count: (page) => page.counts.all },
  { id: 'new', label: 'Новые вакансии', count: (page) => page.counts.new },
  { id: 'waiting', label: 'Жду вакансию', count: (page) => page.counts.waiting },
  { id: 'path', label: 'Ищу путь', count: (page) => page.counts.path },
];

export interface CompanyWantFace {
  readonly tag: { readonly tone: TagTone; readonly label: string };
  readonly brief: string;
  readonly actionLabel: string;
}

/** Строка компании: статус, «вакансии · знакомые» и подпись действия. */
export function companyWantFace(company: CandidateCompanyOpportunity): CompanyWantFace {
  const vacancies =
    company.vacancyCount > 0
      ? `${company.vacancyCount} ${pluralRu(company.vacancyCount, ['вакансия', 'вакансии', 'вакансий'])}`
      : 'нет вакансий';
  const contacts =
    company.contactsCount === null
      ? null
      : company.contactsCount > 0
        ? `${company.contactsCount} ${pluralRu(company.contactsCount, ['знакомый', 'знакомых', 'знакомых'])}`
        : 'знакомых нет';
  const brief = [vacancies, contacts].filter(Boolean).join(' · ');
  if (company.hasNewVacancies) {
    return { tag: { tone: 'ok', label: 'новые вакансии' }, brief, actionLabel: 'Смотреть вакансии' };
  }
  if (company.wantStage === 'waiting') {
    return { tag: { tone: 'part', label: 'жду вакансию' }, brief, actionLabel: 'Открыть компанию' };
  }
  if (company.wantStage === 'path') {
    return { tag: { tone: 'miss', label: 'ищу путь' }, brief, actionLabel: 'Найти путь' };
  }
  return { tag: { tone: '', label: 'хочу' }, brief, actionLabel: 'Открыть компанию' };
}

function headline(page: CandidateCompanyWantPage): string {
  const all = page.counts.all;
  const base = `${all} ${pluralRu(all, ['компания', 'компании', 'компаний'])}`;
  const fresh = page.counts.new;
  return fresh > 0 ? `${base}, в ${fresh} есть новые вакансии` : base;
}

interface AddFormProps {
  readonly primary: boolean;
  readonly onAdded: (name: string) => void;
}

function AddCompanyForm({ primary, onAdded }: AddFormProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!value) {
      setError('Введите название компании.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const added = await setCandidateCompanyWantByName(value);
      setName('');
      onAdded(added.name);
    } catch (reason: unknown) {
      setError(apiErrorMessage(reason, 'Не получилось добавить. Повторите.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cw-add" onSubmit={(event) => void submit(event)} noValidate>
      <div className="field">
        <label htmlFor="cw-add">Добавить компанию</label>
        <input
          id="cw-add"
          type="text"
          placeholder="Например, Северсталь"
          maxLength={NAME_MAX}
          value={name}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        {error ? <StatusLine state="err" text={error} /> : null}
      </div>
      <Button type="submit" variant={primary ? 'primary' : 'default'} icon="plus" busy={busy}>
        {primary ? 'Добавить компанию' : 'Добавить'}
      </Button>
    </form>
  );
}

function CompanyRow({ company }: { readonly company: CandidateCompanyOpportunity }) {
  const face = companyWantFace(company);
  const path = buildNodePath('v10b', { companyId: company.key });
  return (
    <li className="cw-row">
      <Link className="cw-co" to={path}>
        <b>{company.name}</b>
        {company.industry ? <span className="cw-ind"> · {company.industry}</span> : null}
      </Link>
      <span className="cw-st">
        <span className={`tag ${face.tag.tone}`}>{face.tag.label}</span>
      </span>
      <span className="cw-brief num">
        {company.industry ? <span className="cw-ind-m">{company.industry} · </span> : null}
        {face.brief}
      </span>
      <span className="cw-act">
        <Link className="icon-btn btn cw-ib" to={path} aria-label={`${face.actionLabel}: ${company.name}`}>
          <Icon name="right" />
        </Link>
      </span>
    </li>
  );
}

interface WantsState {
  readonly stage: CandidateCompanyWantStageFilter;
  readonly pickStage: (next: CandidateCompanyWantStageFilter) => void;
  readonly state: AsyncState<CandidateCompanyWantPage>;
  readonly reload: () => void;
  readonly extra: readonly CandidateCompanyOpportunity[];
  readonly moreState: 'idle' | 'busy' | 'error';
  readonly showMore: (offset: number) => void;
  readonly added: string | null;
  readonly onAdded: (name: string) => void;
}

function useCompanyWantsList(): WantsState {
  const [stage, setStage] = useState<CandidateCompanyWantStageFilter>('all');
  const [extra, setExtra] = useState<readonly CandidateCompanyOpportunity[]>([]);
  const [moreState, setMoreState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [added, setAdded] = useState<string | null>(null);
  const load = useCallback(
    () => getCompanyWantPage({ ...DEFAULT_COMPANY_WANT_QUERY, stage }, 0),
    [stage],
  );
  const { state, reload } = useAsync(load, 'Компании не загрузились.');
  return {
    stage,
    state,
    reload,
    extra,
    moreState,
    added,
    pickStage: (next) => {
      setExtra([]);
      setAdded(null);
      setStage(next);
    },
    showMore: (offset) => {
      setMoreState('busy');
      getCompanyWantPage({ ...DEFAULT_COMPANY_WANT_QUERY, stage }, offset)
        .then((next) => {
          setExtra((current) => [...current, ...next.items]);
          setMoreState('idle');
        })
        .catch(() => setMoreState('error'));
    },
    onAdded: (name) => {
      setExtra([]);
      setAdded(name);
      reload();
    },
  };
}

function WantsPending({ wants }: { readonly wants: WantsState }) {
  return (
    <div className="page two" data-b640-node="o08" data-b640-section="responses">
      {wants.state.status === 'error' ? (
        <StatusLine
          state="err"
          text={wants.state.error}
          action={
            <Button size="sm" onClick={wants.reload}>
              Повторить
            </Button>
          }
        />
      ) : (
        <p className="ls-state" role="status">
          Загружаем компании…
        </p>
      )}
    </div>
  );
}

function WantsEmpty({ onAdded }: { readonly onAdded: (name: string) => void }) {
  return (
    <div className="page two" data-b640-node="o08" data-b640-section="responses">
      <div className="col col-wide">
        <section className="lead" aria-labelledby="cw-title">
          <h2 className="lead-title is-long" id="cw-title">
            Компаний пока нет
          </h2>
          <AddCompanyForm primary onAdded={onAdded} />
        </section>
      </div>
    </div>
  );
}

interface WantsListProps {
  readonly wants: WantsState;
  readonly page: CandidateCompanyWantPage;
}

function WantsList({ wants, page }: WantsListProps) {
  const items = [...page.items, ...wants.extra];
  const left = page.total - items.length;
  return (
    <>
      {items.length === 0 ? (
        <p className="ls-state" role="status">
          С таким статусом компаний нет
        </p>
      ) : (
        <ul className="cw-rows cw-list" aria-label="Компании">
          {items.map((company) => (
            <CompanyRow company={company} key={company.key} />
          ))}
        </ul>
      )}
      {left > 0 ? (
        <div className="vl-foot">
          <span className="vl-shown num">{`${items.length} из ${page.total}`}</span>
          <Button
            icon="down"
            busy={wants.moreState === 'busy'}
            onClick={() => wants.showMore(items.length)}
          >
            {`Показать ещё ${Math.min(page.limit, left)}`}
          </Button>
        </div>
      ) : null}
      {wants.moreState === 'error' ? (
        <StatusLine state="err" text="Не получилось загрузить ещё. Повторите." />
      ) : null}
    </>
  );
}

/** «Хочу в компанию» (O8) и пустое состояние (O8b). */
export function CompanyWantsScreen() {
  const wants = useCompanyWantsList();
  const page = wants.state.data;
  if (!page) return <WantsPending wants={wants} />;
  if (page.counts.all === 0) return <WantsEmpty onAdded={wants.onAdded} />;
  return (
    <div className="page two" data-b640-node="o08" data-b640-section="responses">
      <div className="col col-wide">
        <section className="lead" aria-labelledby="cw-title">
          <div className="lead-head">
            <h2 className="lead-title is-long" id="cw-title">
              {headline(page)}
            </h2>
            <InfoTip
              label="Источник"
              text={`Вакансии на ${longDate(new Date().toISOString())}. Новые — появились за последние 7 дней.`}
            />
          </div>
          <div className="chips" role="group" aria-label="Статус">
            {CHIPS.map((chip) => (
              <button
                className="chip"
                type="button"
                key={chip.id}
                aria-pressed={wants.stage === chip.id}
                onClick={() => wants.pickStage(chip.id)}
              >
                {`${chip.label} · ${chip.count(page)}`}
              </button>
            ))}
          </div>
          <WantsList wants={wants} page={page} />
          <AddCompanyForm primary={false} onAdded={wants.onAdded} />
          {wants.added ? <ResultLine text={`${wants.added} — в списке`} /> : null}
        </section>
      </div>
    </div>
  );
}
