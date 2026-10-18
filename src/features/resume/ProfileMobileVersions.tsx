import { useEffect } from 'react';
import { CaretRight, FileText, Plus } from '@phosphor-icons/react';
import { ProfileMobileGroup, ProfileMobileRow } from './ProfileMobileElements';
import {
  ActiveVersionPanel,
  VersionCreatePanel,
  dateSummary,
  formatTargetedVersionTitle,
  useProfileResumeVersionsState,
  type ResumeVersionsScreenState,
} from './ProfileResumeVersions';
import { ResumePrintAction } from './ResumePrintAction';
import { ResumePrintDocument } from './ResumePrintDocument';
import type { ProfileMobileDataProps } from './profileMobileTypes';

function MobileMasterResume({ draft }: Pick<ProfileMobileDataProps, 'draft'>) {
  return (
    <ResumePrintAction className="pm-row">
      <span className="pm-ico">
        <FileText size="1em" aria-hidden="true" />
      </span>
      <span className="pm-main">
        <b>Мастер-резюме</b>
        <small>{dateSummary(draft)}</small>
      </span>
      <span className="pm-val">PDF</span>
      <CaretRight className="pm-chev" size="1em" aria-hidden="true" />
    </ResumePrintAction>
  );
}

function MobileVersionFeedback({ state }: { readonly state: ResumeVersionsScreenState }) {
  const { list, active } = state;
  return (
    <>
      {list.loadingVersions ? (
        <p className="pm-note" role="status">
          Загружаем сохранённые версии…
        </p>
      ) : null}
      {list.listError ? (
        <div role="alert" className="pm-note">
          <span>{list.listError}</span>
          <button type="button" className="pm-text" onClick={() => void list.loadVersions()}>
            Повторить
          </button>
        </div>
      ) : null}
      {active.error ? (
        <p role="alert" className="pm-note">
          {active.error}
        </p>
      ) : null}
    </>
  );
}

function MobileVersionList({
  state,
  draft,
}: { readonly state: ResumeVersionsScreenState } & Pick<ProfileMobileDataProps, 'draft'>) {
  const { list, active } = state;
  return (
    <>
      <ProfileMobileGroup>
        <MobileMasterResume draft={draft} />
        {list.versions.map((version) => (
          <ProfileMobileRow
            key={version.id}
            icon={FileText}
            title={formatTargetedVersionTitle(version.title)}
            detail={
              version.status === 'draft'
                ? 'Черновик'
                : version.status === 'approved'
                  ? 'Одобренный снимок'
                  : 'Статус отправки не подтверждён'
            }
            value={active.loadingVersionId === version.id ? 'Загружаем…' : undefined}
            onClick={active.loadingVersionId ? undefined : () => void active.open(version.id)}
          />
        ))}
        {list.nextCursor ? (
          <ProfileMobileRow
            icon={Plus}
            title="Загрузить ещё версии"
            onClick={
              list.loadingVersions ? undefined : () => void list.loadVersions(list.nextCursor, true)
            }
          />
        ) : null}
        <ProfileMobileRow
          icon={Plus}
          title="Создать версию под вакансию"
          onClick={
            list.loadingVersions || !list.currentMasterRevision
              ? undefined
              : () => state.setIsCreating(true)
          }
        />
      </ProfileMobileGroup>
      <MobileVersionFeedback state={state} />
    </>
  );
}

function MobileVersionDetail({
  state,
  draft,
}: { readonly state: ResumeVersionsScreenState } & Pick<ProfileMobileDataProps, 'draft'>) {
  const { active, assessment, update } = state;
  if (!active.version) return null;
  return (
    <ActiveVersionPanel
      version={active.version}
      document={state.document}
      draft={draft}
      error={update.error ?? active.error}
      saving={update.saving}
      approving={update.approving}
      assessment={assessment.assessment}
      assessmentLoading={assessment.loading}
      assessmentError={assessment.error}
      onClose={active.close}
      onSave={update.save}
      onApprove={update.approve}
    />
  );
}

export function ProfileMobileVersions(props: ProfileMobileDataProps) {
  const state = useProfileResumeVersionsState(props.draft, props.memory, props.view);
  const { isCreating, setIsCreating, list, create, active } = state;
  useEffect(() => {
    if (active.version) setIsCreating(false);
  }, [active.version, setIsCreating]);
  return (
    <>
      {active.version ? (
        <MobileVersionDetail state={state} draft={props.draft} />
      ) : isCreating ? (
        <VersionCreatePanel
          isCreating
          onCreate={create.create}
          onCancel={() => {
            setIsCreating(false);
            create.setError(null);
          }}
          saving={create.saving}
          canCreate={Boolean(list.currentMasterRevision) && !list.loadingVersions}
          error={create.error}
        />
      ) : (
        <MobileVersionList state={state} draft={props.draft} />
      )}
      <ResumePrintDocument document={state.document} draft={props.draft} />
    </>
  );
}
