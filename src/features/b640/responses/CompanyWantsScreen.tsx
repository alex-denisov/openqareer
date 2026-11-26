import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyWantPage,
  CandidateCompanyWantStageFilter,
} from '../../../../shared/candidateCompany';
import { listApplicationsPool, type ApplicationView } from '../../applications/applicationsApi';
import { DEFAULT_COMPANY_WANT_QUERY, getCompanyWantPage } from '../../applications/companyWantsApi';
import { apiErrorMessage } from '../../coach/apiClient';
import { setCandidateCompanyWantByName } from '../../vacancies/candidateCompaniesApi';
import { companyLookupKey } from '../../vacancies/vacancyScreenCollections';
import { Button, InfoTip, Link, ResultLine, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { companyNodePath } from '../vacancies/companyPath';
import { useResponseMarks } from './data/responseSummaryApi';
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
  /** Куда ведёт следующий шаг: письмо черновика или карточка этой компании (v10b). */
  readonly actionPath: string;
}

function vacanciesBrief(company: CandidateCompanyOpportunity, pending: boolean): string | null {
  if (pending) return null;
  return company.vacancyCount > 0
    ? `${company.vacancyCount} ${pluralRu(company.vacancyCount, ['вакансия', 'вакансии', 'вакансий'])}`
    : 'нет вакансий';
}

function contactsBrief(company: CandidateCompanyOpportunity): string | null {
  if (company.contactsCount === null) return null;
  return company.contactsCount > 0
    ? `${company.contactsCount} ${pluralRu(company.contactsCount, ['знакомый', 'знакомых', 'знакомых'])}`
    : 'знакомых нет';
}

function nextStepLabel(company: CandidateCompanyOpportunity): string | null {
  const text = company.nextStep?.text.trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
}

/** Карточка компании; без названия компании ссылки на неё нет. */
function companyPath(company: CandidateCompanyOpportunity): string {
  return companyNodePath(company.name) ?? buildNodePath('a02');
}

/** Отклик-черновик компании: письмо ещё не одобрено, вакансия известна. */
export function companyDraftId(
  company: CandidateCompanyOpportunity,
  applications: readonly ApplicationView[],
  approved: ReadonlySet<string>,
): string | null {
  const vacancyIds = new Set(company.vacancies.map((vacancy) => vacancy.id));
  const name = companyLookupKey(company.name);
  const draft = applications.find((item) => {
    if (item.stage !== 'saved' || !item.clusterId) return false;
    if (item.materials.coverLetter || approved.has(item.id)) return false;
    if (vacancyIds.has(item.clusterId)) return true;
    const vacancy = item.vacancy;
    return Boolean(
      name && !vacancy?.companyHidden && companyLookupKey(vacancy?.company ?? '') === name,
    );
  });
  return draft?.id ?? null;
}

type FaceAction = Pick<CompanyWantFace, 'actionLabel' | 'actionPath'>;

function faceAction(
  company: CandidateCompanyOpportunity,
  pending: boolean,
  draftId: string | null,
): FaceAction {
  if (draftId) {
    return {
      actionLabel: 'Проверить письмо',
      actionPath: buildNodePath('o02', { responseId: draftId }),
    };
  }
  const hasVacancies = company.hasNewVacancies || (!pending && company.vacancyCount > 0);
  return {
    actionLabel: hasVacancies ? 'Смотреть вакансии' : (nextStepLabel(company) ?? 'Найти путь'),
    actionPath: companyPath(company),
  };
}

function faceTag(company: CandidateCompanyOpportunity): CompanyWantFace['tag'] {
  if (company.hasNewVacancies) return { tone: 'ok', label: 'новые вакансии' };
  if (company.wantStage === 'waiting') return { tone: 'part', label: 'жду вакансию' };
  if (company.wantStage === 'path') return { tone: 'miss', label: 'ищу путь' };
  return { tone: '', label: 'хочу' };
}

/**
 * Строка компании: статус, «вакансии · знакомые» и следующий шаг. Пока подборка догружается
 * (`pending`), число вакансий не показывается, чтобы не написать «нет вакансий» раньше времени.
 */
export function companyWantFace(
  company: CandidateCompanyOpportunity,
  pending = false,
  draftId: string | null = null,
): CompanyWantFace {
  const brief = [vacanciesBrief(company, pending), contactsBrief(company)]
    .filter(Boolean)
    .join(' · ');
  return { tag: faceTag(company), brief, ...faceAction(company, pending, draftId) };
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

interface CompanyRowProps {
  readonly company: CandidateCompanyOpportunity;
  readonly pending: boolean;
  readonly draftId: string | null;
  /** Первая строка с черновиком письма: главное действие экрана. */
  readonly next: boolean;
}

function CompanyRow({ company, pending, draftId, next }: CompanyRowProps) {
  const face = companyWantFace(company, pending, draftId);
  return (
    <li className={next ? 'cw-row is-next' : 'cw-row'}>
      <Link className="cw-co" to={companyPath(company)}>
        <b>{company.name}</b>
        {company.industry ? <span className="cw-ind"> · {company.industry}</span> : null}
      </Link>
      <span className="cw-st">
        <span className={`tag ${face.tag.tone}`}>{face.tag.label}</span>
      </span>
      <span className="cw-brief num">
        {company.industry ? <span className="cw-ind-m">{company.industry} · </span> : null}
        {pending ? <span className="cw-wait" aria-hidden="true" /> : null}
        {pending && face.brief ? ' · ' : null}
        {face.brief}
      </span>
      <span className="cw-act">
        <Link
          className={next ? 'btn is-primary' : 'btn cw-ib'}
          to={face.actionPath}
          aria-label={`${face.actionLabel}: ${company.name}`}
        >
          {face.actionLabel}
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
  readonly applications: readonly ApplicationView[];
  readonly approved: ReadonlySet<string>;
  readonly added: string | null;
  readonly onAdded: (name: string) => void;
}

/** Паузы перезапроса: нарастают, в сумме не больше минуты. */
const PENDING_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

/** Пауза перед перезапросом номер `attempt`; null — минута вышла, больше не спрашиваем. */
export function pendingRefreshDelay(attempt: number): number | null {
  return PENDING_DELAYS_MS[attempt] ?? null;
}

/** Подборка догружается: счётчики вакансий перезапрашиваются сами, без кнопки (B645). */
function usePendingRefresh(state: AsyncState<CandidateCompanyWantPage>, reload: () => void): void {
  const [tries, setTries] = useState(0);
  const pending = state.status === 'ready' && state.data.vacanciesPending === true;
  useEffect(() => {
    const delay = pending ? pendingRefreshDelay(tries) : null;
    if (delay === null) return undefined;
    const timer = setTimeout(() => {
      setTries((value) => value + 1);
      reload();
    }, delay);
    return () => clearTimeout(timer);
  }, [pending, tries, reload]);
}

const NO_APPLICATIONS: readonly ApplicationView[] = [];

async function loadApplications(signal: AbortSignal): Promise<readonly ApplicationView[]> {
  return (await listApplicationsPool({}, signal)).items;
}

/** Отклики для «Проверить письмо»; не загрузились — строки ведут в карточки компаний. */
function useDrafts(): Pick<WantsState, 'applications' | 'approved'> {
  const { state } = useAsync(loadApplications, 'Отклики не загрузились.');
  const { approvedLetters } = useResponseMarks();
  return { applications: state.data ?? NO_APPLICATIONS, approved: approvedLetters };
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
  usePendingRefresh(state, reload);
  const drafts = useDrafts();
  return {
    ...drafts,
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
  const draftIds = items.map((item) => companyDraftId(item, wants.applications, wants.approved));
  const nextIndex = draftIds.findIndex((id) => id !== null);
  return (
    <>
      {items.length === 0 ? (
        <p className="ls-state" role="status">
          С таким статусом компаний нет
        </p>
      ) : (
        <ul className="cw-rows cw-list" aria-label="Компании">
          {items.map((company, index) => (
            <CompanyRow
              company={company}
              key={company.key}
              pending={page.vacanciesPending === true}
              draftId={draftIds[index] ?? null}
              next={index === nextIndex}
            />
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
                {chip.id === 'new' && page.vacanciesPending ? (
                  <>
                    {`${chip.label} · `}
                    <span className="cw-wait is-num" aria-hidden="true" />
                  </>
                ) : (
                  `${chip.label} · ${chip.count(page)}`
                )}
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
