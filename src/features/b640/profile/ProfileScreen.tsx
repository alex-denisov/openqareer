import { Fragment, useEffect } from 'react';
import { pluralRu } from '../../../../shared/pluralRu';
import type { CandidateStatusState } from '../../../../shared/candidateStatus';
import { useCandidateMediaSrc } from '../../resume/candidateMediaSrc';
import { initialsFor } from '../../shell/accountIdentity';
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
import { IncomeRows } from './IncomeRows';
import {
  achievementGroups,
  missingAchievementKinds,
  type AchievementGroup,
} from './achievementsModel';
import { questionCount } from './partTwoModel';
import './profile.css';
import { getIncome, type ProfileIncome } from './profileExtrasApi';
import { getStatus } from './statusChoice';
import { ProfileAside, TermsRowMobile } from './ProfileAside';
import { loadTerms, type ProfileTerms } from './profileAsideApi';

function loadProfile(): Promise<ResumeStudioView> {
  return getResumeStudio();
}

function Head({ draft }: { readonly draft: ResumeDraft }) {
  const name = draft.candidate.fullName?.trim();
  const role = headLine(draft);
  const photo = useCandidateMediaSrc(draft.candidate.photoMediaId);
  return (
    <section className="phead col-wide" aria-labelledby="ph-name">
      <div className="phead-pic">
        {photo ? (
          <img className="phead-photo" src={photo} alt="Фото профиля" width={72} height={72} />
        ) : (
          // Без фото круг 72 с инициалами: шапка стоит по фото, как в макете (B645 s01).
          <span className="phead-ini" aria-hidden="true">
            {initialsFor(name)}
          </span>
        )}
      </div>
      <div className="phead-main">
        <h2 className="phead-name" id="ph-name">
          {name || 'Имя не указано'}
        </h2>
        {role ? <p className="phead-role">{role}</p> : null}
      </div>
      <Link className="icon-btn" to={buildNodePath('p08')} aria-label="Изменить фото">
        <Icon name="edit" />
      </Link>
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

interface ExperienceProps {
  readonly view: ResumeStudioView;
  readonly draft: ResumeDraft;
  /** Доход и ожидания; `null` — не прочитаны, строк нет. */
  readonly income: ProfileIncome | null;
}

function Experience({ view, draft, income }: ExperienceProps) {
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
        <RefineLink count={questionCount(draft)} />
      </div>
      {jobs.length > 0 ? (
        <JobList jobs={jobs} firstExtra={income ? <IncomeRows initial={income} /> : undefined} />
      ) : (
        <p className="mod-text">Мест работы пока нет</p>
      )}
    </ProfileSection>
  );
}

/** «Уточнить · 1 вопрос»: число вопросов о профиле, как в макете; без вопросов — «Уточнить». */
function RefineLink({ count }: { readonly count: number }) {
  const label =
    count > 0 ? `Уточнить · ${pluralRu(count, ['вопрос', 'вопроса', 'вопросов'])}` : 'Уточнить';
  return (
    <Link
      className="row-act"
      to={buildNodePath('p09')}
      aria-label={label.replace('Уточнить', 'Уточнить профиль')}
    >
      <Icon name="target" />
      {label}
    </Link>
  );
}

/** Пустой раздел: «Не указано» и «Добавить» вместо пропуска раздела (B645 s01). */
function EmptyRecords() {
  return (
    <p className="rec">
      <span className="rec-text dim">Не указано</span>
      <Link className="row-act" to={buildNodePath('p04')}>
        Добавить
      </Link>
    </p>
  );
}

interface GroupSectionProps {
  readonly id: string;
  readonly title: string;
  readonly groups: readonly AchievementGroup[];
}

/** Раздел из групп с подзаголовками («Награды», «Публикации и выступления»). */
function GroupSection({ id, title, groups }: GroupSectionProps) {
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  return (
    <ProfileSection id={id} title={title} count={total > 0 ? String(total) : undefined}>
      {total > 0 ? (
        groups.map((group) => (
          <Fragment key={group.sub}>
            <h3 className="psec-sub">{group.sub}</h3>
            <RecordList rows={group.rows} />
          </Fragment>
        ))
      ) : (
        <EmptyRecords />
      )}
    </ProfileSection>
  );
}

/** «Ещё можно добавить: Патенты, Волонтёрство» — виды записей, которых нет. */
function AddMore({ kinds }: { readonly kinds: readonly string[] }) {
  if (kinds.length === 0) return null;
  return (
    <p className="psec-addmore">
      Ещё можно добавить:{' '}
      {kinds.map((kind) => (
        <Link className="row-act" to={buildNodePath('p04')} key={kind}>
          {kind}
        </Link>
      ))}
    </p>
  );
}

interface RecordSectionProps {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly RecordRow[];
  /** Пустой раздел показывать с «Добавить», а не прятать. */
  readonly always?: boolean;
}

/** Раздел-список; без записей раздела нет, кроме разделов `always`. */
function RecordSection({ id, title, rows, always = false }: RecordSectionProps) {
  if (rows.length === 0 && !always) return null;
  return (
    <ProfileSection id={id} title={title} count={rows.length > 0 ? String(rows.length) : undefined}>
      {rows.length > 0 ? <RecordList rows={rows} /> : <EmptyRecords />}
    </ProfileSection>
  );
}

function Lists({ draft }: { readonly draft: ResumeDraft }) {
  const rows = recordRows(draft);
  const extras = achievementGroups(draft);
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
      <RecordSection id="sec-recs" title="Рекомендации" rows={rows.recommendations} always />
      <GroupSection id="sec-awards" title="Награды и публикации" groups={extras.awards} />
      <GroupSection id="sec-orgs" title="Организации и волонтёрство" groups={extras.orgs} />
      <AddMore kinds={missingAchievementKinds(draft)} />
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

interface FilledProps extends ExperienceProps {
  readonly terms: Load<ProfileTerms>;
}

function Filled({ view, draft, income, terms }: FilledProps) {
  return (
    <>
      <div className="col">
        <Experience view={view} draft={draft} income={income} />
        <Lists draft={draft} />
      </div>
      <ProfileAside draft={draft} terms={terms} />
    </>
  );
}

/** s01 «Профиль»: шапка, статус, опыт и разделы-списки; справа условия, связи, вопросы и резюме. */
export function ProfileScreen({ node }: { readonly node: B640Node }) {
  const profile = useLoad(loadProfile);
  const status = useLoad(getStatus);
  const income = useLoad(getIncome);
  const terms = useLoad(loadTerms);
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
          {draft ? <TermsRowMobile terms={terms} /> : null}
          {draft ? (
            <Filled
              view={profile.data}
              draft={draft}
              income={income.state === 'ready' ? income.data : null}
              terms={terms}
            />
          ) : (
            <EmptyProfile />
          )}
        </>
      ) : null}
    </div>
  );
}
