import type { ReactNode } from 'react';
import { Icon, Link } from '../kit';
import { pluralRu } from '../../../../shared/pluralRu';
import {
  LANGUAGE_SCALE_STEPS,
  splitVisible,
  type JobRow,
  type LanguageRow,
  type RecordRow,
} from './profileModel';

const JOBS_VISIBLE = 2;
const RECORDS_VISIBLE = 3;

interface SectionProps {
  readonly id: string;
  readonly title: string;
  /** Число записей или итог справа от заголовка. */
  readonly count?: string;
  readonly open?: boolean;
  readonly children: ReactNode;
}

/** Раздел профиля: сворачиваемый блок с заголовком и числом записей. */
export function ProfileSection({ id, title, count, open = false, children }: SectionProps) {
  return (
    <details className="psec" open={open} id={id}>
      <summary>
        <h2 id={`${id}-t`}>{title}</h2>
        {count ? <span className="psec-n num">{count}</span> : null}
        <Icon name="down" className="psec-chev" />
      </summary>
      <div className="psec-body">{children}</div>
    </details>
  );
}

function JobFacts({ job, extra }: { readonly job: JobRow; readonly extra?: ReactNode }) {
  return (
    <dl className="job-kv">
      <dt>Команда</dt>
      <dd className="rec">
        {job.team ? (
          <span className="rec-text">{job.team}</span>
        ) : (
          <>
            <span className="rec-text dim">Не указано</span>
            <Link className="row-act" to={job.editPath}>
              Добавить
            </Link>
          </>
        )}
      </dd>
      {job.results.length > 0 ? (
        <>
          <dt>Результаты</dt>
          <dd>
            <ul className="job-res">
              {job.results.map((result) => (
                <li className="rec" key={result}>
                  <span className="rec-text">{result}</span>
                </li>
              ))}
            </ul>
          </dd>
        </>
      ) : null}
      {job.stack ? (
        <>
          <dt>Стек</dt>
          <dd>{job.stack}</dd>
        </>
      ) : null}
      {extra}
    </dl>
  );
}

function Job({ job, extra }: { readonly job: JobRow; readonly extra?: ReactNode }) {
  const titleId = `job-${job.id}`;
  return (
    <article className="job" aria-labelledby={titleId}>
      <header className="job-head">
        <span className="job-ico">
          <Icon name="building" />
        </span>
        <div>
          <h3 className="job-title" id={titleId}>
            {job.title}
          </h3>
          <p className="job-org">
            {job.employer}
            {job.period ? <span className="num">{` · ${job.period}`}</span> : null}
          </p>
        </div>
        <Link
          className="icon-btn"
          to={job.editPath}
          aria-label={`Изменить запись: ${job.employer || job.title}`}
        >
          <Icon name="edit" />
        </Link>
      </header>
      <JobFacts job={job} extra={extra} />
    </article>
  );
}

/** Места работы: первые два на виду, остальные — под «Ещё N мест работы». */
export interface JobListProps {
  readonly jobs: readonly JobRow[];
  /** Строки в карточке первого, нынешнего места: доход и ожидания. */
  readonly firstExtra?: ReactNode;
}

export function JobList({ jobs, firstExtra }: JobListProps) {
  const { shown, rest } = splitVisible(jobs, JOBS_VISIBLE);
  const names = rest
    .map((job) => job.employer)
    .filter(Boolean)
    .join(', ');
  return (
    <div className="jobs">
      {shown.map((job, index) => (
        <Job job={job} key={job.id} extra={index === 0 ? firstExtra : undefined} />
      ))}
      {rest.length > 0 ? (
        <details className="more-n">
          <summary>
            <Icon name="down" />
            {`Ещё ${pluralRu(rest.length, ['место работы', 'места работы', 'мест работы'])}`}
            {names ? <span className="dim">{` · ${names}`}</span> : null}
          </summary>
          {rest.map((job) => (
            <Job job={job} key={job.id} />
          ))}
        </details>
      ) : null}
    </div>
  );
}

function Records({ rows }: { readonly rows: readonly RecordRow[] }) {
  return (
    <ul className="psec-list">
      {rows.map((row) => (
        <li className="rec prec" key={row.id}>
          <span className="rec-text">
            <b>{row.title}</b>
            {row.sub ? <small>{row.sub}</small> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Список записей раздела: три на виду, остальные — под «Ещё N». */
export function RecordList({ rows }: { readonly rows: readonly RecordRow[] }) {
  const { shown, rest } = splitVisible(rows, RECORDS_VISIBLE);
  return (
    <>
      <Records rows={shown} />
      {rest.length > 0 ? (
        <details className="more-n">
          <summary>
            <Icon name="down" />
            {`Ещё ${pluralRu(rest.length, ['запись', 'записи', 'записей'])}`}
          </summary>
          <Records rows={rest} />
        </details>
      ) : null}
    </>
  );
}

export function SkillChips({ names }: { readonly names: readonly string[] }) {
  return (
    <ul className="skill-chips">
      {names.map((name) => (
        <li key={name}>
          <span className="skill-chip">{name}</span>
        </li>
      ))}
    </ul>
  );
}

export function LanguageList({ rows }: { readonly rows: readonly LanguageRow[] }) {
  return (
    <ul className="lang-list">
      {rows.map((row) => (
        <li className="lang-row" key={row.id}>
          <b>{row.name}</b>
          {row.level ? (
            <>
              <span className="lang-scale" role="img" aria-label={`Уровень: ${row.level}`}>
                {Array.from({ length: LANGUAGE_SCALE_STEPS }, (_, index) => (
                  <i className={index < row.filled ? 'on' : undefined} key={index} />
                ))}
              </span>
              <span className="lang-lv num">{row.level}</span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
