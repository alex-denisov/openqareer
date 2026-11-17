import { useEffect } from 'react';
import type { CandidateStatusState } from '../../../../shared/candidateStatus';
import { getResumeStudio } from '../../resume/resumeApi';
import type { ResumeDraft, ResumeStudioView } from '../../resume/resumeTypes';
import { Button, Icon, Link } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useLoad, type Load } from '../today/useLoad';
import {
  experienceSummary,
  headLine,
  jobRow,
  languageRow,
  recordRows,
  statementsOf,
  type LanguageRow,
  type RecordRow,
} from './profileModel';
import { JobList, LanguageList, ProfileSection, RecordList, SkillChips } from './ProfileSections';
import { PROFILE_CHANGED } from './ExperienceEditScreen';
import { getStatus } from './statusChoice';

function loadProfile(): Promise<ResumeStudioView> {
  return getResumeStudio();
}

function Head({ draft }: { readonly draft: ResumeDraft }) {
  const name = draft.candidate.fullName?.trim();
  const role = headLine(draft);
  if (!name && !role) return null;
  return (
    <section className="phead col-wide" aria-labelledby="ph-name">
      <div className="phead-main">
        <h2 className="phead-name" id="ph-name">
          {name || 'Имя не указано'}
        </h2>
        {role ? <p className="phead-role">{role}</p> : null}
      </div>
    </section>
  );
}

/** Статус кандидата и переход к его смене. Пока статус читается, блока нет. */
function StatusRow({ status }: { readonly status: Load<CandidateStatusState> }) {
  if (status.state !== 'ready') return null;
  return (
    <section className="status status-slim col-wide" aria-labelledby="st-now">
      <span className="status-ico">
        <Icon name="compass" />
      </span>
      <div className="status-main">
        <div className="eyebrow">Статус</div>
        <div className="status-now" id="st-now">
          {status.data.current.title}
        </div>
      </div>
      <Link className="btn" to={buildNodePath('s02')}>
        <Icon name="edit" />
        Сменить
      </Link>
    </section>
  );
}

function Experience({
  view,
  draft,
}: {
  readonly view: ResumeStudioView;
  readonly draft: ResumeDraft;
}) {
  const statements = statementsOf(view);
  const jobs = draft.experience.map((entry) => jobRow(entry, statements));
  return (
    <ProfileSection
      id="sec-exp"
      title="Опыт"
      open
      count={experienceSummary(draft.experience, new Date())}
    >
      <div className="actions exp-check">
        <Link
          className="row-act"
          to={buildNodePath('p06')}
          aria-label="Посмотреть, как мы прочитали профиль"
        >
          <Icon name="eye" />
          Как мы прочитали
        </Link>
        <Link className="row-act" to={buildNodePath('p09')} aria-label="Уточнить профиль">
          <Icon name="target" />
          Уточнить
        </Link>
      </div>
      {jobs.length > 0 ? <JobList jobs={jobs} /> : <p className="mod-text">Мест работы пока нет</p>}
    </ProfileSection>
  );
}

interface RecordSectionProps {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly RecordRow[];
}

/** Раздел-список; без записей раздела нет. */
function RecordSection({ id, title, rows }: RecordSectionProps) {
  if (rows.length === 0) return null;
  return (
    <ProfileSection id={id} title={title} count={String(rows.length)}>
      <RecordList rows={rows} />
    </ProfileSection>
  );
}

function Lists({ draft }: { readonly draft: ResumeDraft }) {
  const rows = recordRows(draft);
  const about = draft.candidate.about?.trim();
  const skills = (draft.skills ?? []).map((skill) => skill.name.trim()).filter(Boolean);
  const languages = draft.languages
    .map(languageRow)
    .filter((row): row is LanguageRow => row !== null);
  return (
    <>
      {about ? (
        <ProfileSection id="sec-about" title="О себе" open>
          <p className="prec-about">{about}</p>
        </ProfileSection>
      ) : null}
      <RecordSection id="sec-education" title="Образование" rows={rows.education} />
      <RecordSection id="sec-courses" title="Курсы и сертификаты" rows={rows.courses} />
      {skills.length > 0 ? (
        <ProfileSection id="sec-skills" title="Навыки" open count={String(skills.length)}>
          <SkillChips names={skills} />
        </ProfileSection>
      ) : null}
      {languages.length > 0 ? (
        <ProfileSection id="sec-languages" title="Языки" open count={String(languages.length)}>
          <LanguageList rows={languages} />
        </ProfileSection>
      ) : null}
      <RecordSection id="sec-projects" title="Проекты" rows={rows.projects} />
      <RecordSection id="sec-recs" title="Рекомендации" rows={rows.recommendations} />
    </>
  );
}

function EmptyProfile() {
  return (
    <div className="col">
      <section className="lead" aria-labelledby="pf-empty">
        <h2 className="lead-title" id="pf-empty">
          Профиль пока пуст
        </h2>
        <div className="actions">
          <Link className="btn" to={buildNodePath('p04')}>
            <Icon name="plus" />
            Добавить опыт
          </Link>
        </div>
      </section>
    </div>
  );
}

function Filled({ view, draft }: { readonly view: ResumeStudioView; readonly draft: ResumeDraft }) {
  return (
    <>
      <div className="col">
        <Experience view={view} draft={draft} />
        <Lists draft={draft} />
      </div>
      <div className="col">
        <section className="mod links-mod" aria-labelledby="ln-t">
          <h3 className="mod-title" id="ln-t">
            Связи
          </h3>
          <Link className="row-act" to={buildNodePath('p11')}>
            Посмотреть
          </Link>
        </section>
      </div>
    </>
  );
}

/** s01 «Профиль»: шапка, статус, опыт и разделы-списки. */
export function ProfileScreen({ node }: { readonly node: B640Node }) {
  const profile = useLoad(loadProfile);
  const status = useLoad(getStatus);
  const reload = profile.retry;
  // Правку отменили из тоста, пока профиль открыт: показываем, что на сервере.
  useEffect(() => {
    window.addEventListener(PROFILE_CHANGED, reload);
    return () => window.removeEventListener(PROFILE_CHANGED, reload);
  }, [reload]);
  const draft = profile.state === 'ready' ? profile.data.draft : null;
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      {profile.state === 'loading' ? (
        <p className="ls-state col-wide" role="status">
          <span>Загружаем профиль…</span>
        </p>
      ) : null}
      {profile.state === 'error' ? (
        <div className="c12-alert col-wide" role="alert">
          <Icon name="warn" />
          <div>
            <p className="c12-alert-t">Профиль не загрузился</p>
          </div>
          <Button size="sm" icon="repeat" onClick={profile.retry}>
            Повторить
          </Button>
        </div>
      ) : null}
      {profile.state === 'ready' ? (
        <>
          {draft ? <Head draft={draft} /> : null}
          <StatusRow status={status} />
          {draft ? <Filled view={profile.data} draft={draft} /> : <EmptyProfile />}
        </>
      ) : null}
    </div>
  );
}
