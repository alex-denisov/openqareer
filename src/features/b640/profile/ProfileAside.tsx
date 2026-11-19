import { Fragment } from 'react';
import type { ResumeDraft } from '../../resume/resumeTypes';
import { Icon, InfoTip, Link } from '../kit';
import { buildNodePath } from '../routes';
import { BlockError } from '../today/parts';
import { useLoad, type Load } from '../today/useLoad';
import { nextQuestion } from './partTwoModel';
import {
  loadLinksTotal,
  loadVersions,
  type ProfileTerms,
  type ProfileVersions,
} from './profileAsideApi';
import {
  answerLabel,
  moreVersionsLabel,
  termsSummary,
  versionDate,
  versionTag,
  type TermsRow,
} from './profileAsideModel';
import { headLine, languageRow } from './profileModel';

function TermsList({ rows }: { readonly rows: readonly TermsRow[] }) {
  return (
    <dl className="kv terms-kv">
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Телефон: условия свёрнуты в одну строку под статусом. */
export function TermsRowMobile({ terms }: { readonly terms: Load<ProfileTerms> }) {
  if (terms.state !== 'ready' || terms.data.rows.length === 0) return null;
  return (
    <details className="terms-row only-mob col-wide">
      <summary>
        <span className="terms-l">Условия</span>
        <span className="terms-sum">{termsSummary(terms.data.rows)}</span>
        <Icon name="down" />
      </summary>
      <TermsList rows={terms.data.rows} />
      <Link className="row-act" to={buildNodePath('s09')}>
        Изменить
      </Link>
    </details>
  );
}

function TermsModule({ terms }: { readonly terms: Load<ProfileTerms> }) {
  if (terms.state === 'loading') return null;
  return (
    <section className="mod terms only-desk" aria-labelledby="terms-t">
      <div className="terms-head">
        <h3 className="mod-title" id="terms-t">
          Условия поиска
        </h3>
        <Link className="row-act" to={buildNodePath('s09')}>
          {terms.state === 'ready' && terms.data.rows.length === 0 ? 'Указать' : 'Изменить'}
        </Link>
      </div>
      {terms.state === 'error' ? (
        <BlockError text="Условия не загрузились" onRetry={terms.retry} />
      ) : terms.data.rows.length > 0 ? (
        <TermsList rows={terms.data.rows} />
      ) : (
        <p className="mod-text">Условия не заданы</p>
      )}
    </section>
  );
}

function LinksModule() {
  const total = useLoad(loadLinksTotal);
  return (
    <section className="mod links-mod" aria-labelledby="ln-t">
      <h3 className="mod-title" id="ln-t">
        Связи
        {total.state === 'ready' && total.data > 0 ? (
          <>
            {' '}
            <span className="num dim">· {total.data}</span>
          </>
        ) : null}
      </h3>
      <Link className="row-act" to={buildNodePath('p11')}>
        Посмотреть
      </Link>
    </section>
  );
}

/** Чего мы не знаем: вопрос выводится из профиля; без вопроса модуля нет. */
function UnknownsModule({ draft }: { readonly draft: ResumeDraft }) {
  const question = nextQuestion(draft);
  if (!question) return null;
  return (
    <section className="mod" aria-labelledby="unk-title">
      <h3 className="mod-title" id="unk-title">
        Чего мы не знаем
      </h3>
      <ul className="rows exp-rows">
        <li className="row">
          <div>
            <div className="row-title">{question.text}</div>
          </div>
        </li>
      </ul>
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('p09')}>
          <Icon name="chat" />
          {answerLabel(1)}
        </Link>
      </div>
    </section>
  );
}

function CvThumb() {
  return (
    <span className="cv-thumb cv-strict" aria-hidden="true">
      <u />
      <b />
      <s />
      <i className="w9" />
      <i className="w7" />
      <s />
      <i className="w9" />
      <i className="w6" />
      <i className="w8" />
    </span>
  );
}

function languagesLine(draft: ResumeDraft): string | null {
  const names = draft.languages
    .map(languageRow)
    .flatMap((row) => (row ? [row.name.toLocaleLowerCase('ru')] : []));
  if (names.length === 0) return null;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} и ${names.at(-1)}`;
}

interface BaseProps {
  readonly draft: ResumeDraft;
  readonly role: string | null;
}

function BaseResume({ draft, role }: BaseProps) {
  const title = role ?? (draft.candidate.headline?.trim() || headLine(draft) || 'Резюме');
  const languages = languagesLine(draft);
  return (
    <ul className="cv-base">
      <li>
        <CvThumb />
        <div className="cv-main">
          <b>{title}</b>
          {languages ? <small>{languages}</small> : null}
        </div>
        <div className="cv-acts">
          <Link
            className="btn cons-btn"
            to={buildNodePath('k01')}
            aria-label="Улучшить с консультантом"
          >
            <Icon name="chat" />
            <span className="cons-l" aria-hidden="true">
              Улучшить с консультантом
            </span>
            <span className="cons-s" aria-hidden="true">
              Консультант
            </span>
          </Link>
        </div>
      </li>
    </ul>
  );
}

function VersionList({ versions }: { readonly versions: ProfileVersions }) {
  if (versions.total === 0) return null;
  const more = moreVersionsLabel(versions.total, versions.items.length);
  return (
    <>
      <h4 className="cv-sub">Под вакансии · {versions.total}</h4>
      <ul className="cv-list">
        {versions.items.map((item) => {
          const tag = versionTag(item.status);
          const date = versionDate(item.updatedAt);
          return (
            <li key={item.id} className="cv-row">
              <div className="cv-main">
                <b>{item.title}</b>
                {date ? (
                  <small>
                    <span className="num">{date}</span>
                  </small>
                ) : null}
              </div>
              <span className={`tag ${tag.tone}`}>{tag.text}</span>
            </li>
          );
        })}
      </ul>
      {more ? (
        <Link className="row-act" to={buildNodePath('o01')}>
          {more}
        </Link>
      ) : null}
    </>
  );
}

interface ResumeProps {
  readonly draft: ResumeDraft;
  readonly terms: Load<ProfileTerms>;
}

function ResumeModule({ draft, terms }: ResumeProps) {
  const versions = useLoad(loadVersions);
  const role = terms.state === 'ready' ? terms.data.role : null;
  return (
    <section className="mod" aria-labelledby="cv-title">
      <h3 className="mod-title" id="cv-title">
        Резюме под роль
        <InfoTip
          label="Откуда резюме"
          text="Резюме под роль собрано из профиля. Резюме под вакансии собираются из него."
        />
      </h3>
      <BaseResume draft={draft} role={role} />
      {versions.state === 'error' ? (
        <BlockError text="Резюме под вакансии не загрузились" onRetry={versions.retry} />
      ) : null}
      {versions.state === 'ready' ? <VersionList versions={versions.data} /> : null}
    </section>
  );
}

interface AsideProps {
  readonly draft: ResumeDraft;
  readonly terms: Load<ProfileTerms>;
}

/** Правая колонка s01: условия поиска, связи, чего мы не знаем, резюме под роль. */
export function ProfileAside({ draft, terms }: AsideProps) {
  return (
    <div className="col">
      <TermsModule terms={terms} />
      <LinksModule />
      <UnknownsModule draft={draft} />
      <ResumeModule draft={draft} terms={terms} />
    </div>
  );
}
