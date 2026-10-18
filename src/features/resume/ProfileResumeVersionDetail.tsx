import React, { useCallback, useEffect, useState } from 'react';
import type { ResumeAtsAssessment } from '../../../server/domain/resumeAtsAssessment';
import type { ResumeDraft } from '../../../server/domain/resumeDraft';
import type {
  ResumeVersionSummary,
  StoredResumeVersion,
} from '../../../server/domain/resumeVersions';
import { ProfileAtsAssessment } from './ProfileAtsAssessment';
import { ResumeAtsView } from './ResumeAtsView';
import { selectDocument } from './resumeStudioModel';
import { updateResumeVersion, type ResumeVersionResource } from './resumeVersionsApi';
import { RESUME_VERSION_COLLECTION_CHANGED_EVENT } from './useProfileAtsAssessment';

export interface ActiveVersionPanelProps {
  readonly version: StoredResumeVersion;
  readonly document: ReturnType<typeof selectDocument>;
  readonly draft: ResumeDraft;
  readonly error: string | null;
  readonly saving: boolean;
  readonly approving: boolean;
  readonly assessment: ResumeAtsAssessment | null;
  readonly assessmentLoading: boolean;
  readonly assessmentError: string | null;
  readonly onClose: () => void;
  readonly onSave: (input: {
    readonly title: string;
    readonly requirements: readonly string[];
  }) => void;
  readonly onApprove: () => void;
}

interface ResumeVersionMutationProps {
  readonly version: StoredResumeVersion | null;
  readonly currentMasterRevision: string | null;
  readonly setVersion: (version: StoredResumeVersion) => void;
  readonly setVersions: React.Dispatch<React.SetStateAction<readonly ResumeVersionSummary[]>>;
  readonly refreshAssessment: (versionId: string) => Promise<void>;
}

export function versionStatus(status: StoredResumeVersion['status']): string {
  if (status === 'draft') return 'Черновик';
  if (status === 'approved') return 'Одобрено';
  return 'Статус отправки не подтверждён';
}

export function resumeVersionErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Не удалось сохранить версию резюме. Попробуйте ещё раз.';
}

export function versionSummary(version: StoredResumeVersion): ResumeVersionSummary {
  return {
    id: version.id,
    title: version.title,
    requirements: version.requirements,
    status: version.status,
    revision: version.revision,
    sourceMasterRevision: version.sourceMasterRevision,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

export function announceVersionCollectionChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(RESUME_VERSION_COLLECTION_CHANGED_EVENT));
  }
}

function applyVersionResource(
  props: ResumeVersionMutationProps,
  resource: ResumeVersionResource,
  refreshAssessment: boolean,
): void {
  props.setVersion(resource.version);
  props.setVersions((previous) => [
    versionSummary(resource.version),
    ...previous.filter((item) => item.id !== resource.version.id),
  ]);
  announceVersionCollectionChange();
  if (refreshAssessment) void props.refreshAssessment(resource.version.id);
}

async function runVersionMutation(
  action: () => Promise<ResumeVersionResource>,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
  setError: (error: string | null) => void,
  onSuccess: (resource: ResumeVersionResource) => void,
): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    onSuccess(await action());
  } catch (reason) {
    setError(resumeVersionErrorMessage(reason));
  } finally {
    setBusy(false);
  }
}

export function useUpdateResumeVersion(props: ResumeVersionMutationProps) {
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (input: { readonly title: string; readonly requirements: readonly string[] }) => {
      const { version, currentMasterRevision } = props;
      if (!version || version.status === 'sent') return;
      if (!currentMasterRevision) {
        return setError('Текущая версия мастер-резюме ещё не загружена.');
      }
      await runVersionMutation(
        () =>
          updateResumeVersion(version.id, {
            ...input,
            expectedRevision: version.revision,
            expectedMasterRevision: currentMasterRevision,
          }),
        setSaving,
        setError,
        (resource) => applyVersionResource(props, resource, true),
      );
    },
    [props],
  );

  const approve = useCallback(async () => {
    const { version, currentMasterRevision } = props;
    if (!version || version.status !== 'draft') return;
    if (!currentMasterRevision) {
      return setError('Текущая версия мастер-резюме ещё не загружена.');
    }
    await runVersionMutation(
      () =>
        updateResumeVersion(version.id, {
          title: version.title,
          requirements: version.requirements,
          expectedRevision: version.revision,
          expectedMasterRevision: currentMasterRevision,
          status: 'approved',
        }),
      setApproving,
      setError,
      (resource) => applyVersionResource(props, resource, false),
    );
  }, [props]);

  return { saving, approving, error, setError, save, approve };
}

function ActiveVersionHeader({
  version,
  onClose,
}: {
  readonly version: StoredResumeVersion;
  readonly onClose: () => void;
}) {
  return (
    <div className="career-profile-screen-versions-row">
      <div>
        <h3>Версия под вакансию «{version.title}»</h3>
        <p className="career-profile-screen-quality-note">
          {versionStatus(version.status)} · редакция {version.revision}
        </p>
      </div>
      <button
        type="button"
        className="career-secondary-button career-btn-sm"
        data-testid="close-targeted-version"
        onClick={onClose}
      >
        Закрыть
      </button>
    </div>
  );
}

function ResumeVersionApprovalAction({
  busy,
  disabled,
  dirty,
  onApprove,
}: {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly dirty: boolean;
  readonly onApprove: () => void;
}) {
  return (
    <div className="career-profile-screen-versions-row">
      <p className="career-profile-screen-quality-note" role={dirty ? 'status' : undefined}>
        {dirty
          ? 'Сохраните изменения перед подтверждением версии.'
          : 'Подтвердите сохранённый снимок этой версии.'}
      </p>
      <button
        type="button"
        className="career-primary-button career-btn-sm"
        aria-busy={busy}
        disabled={disabled || dirty}
        onClick={onApprove}
      >
        {busy ? 'Подтверждаем…' : 'Подтвердить версию'}
      </button>
    </div>
  );
}

export function ActiveVersionPanel(props: ActiveVersionPanelProps) {
  const { version } = props;
  const canEdit = version.status !== 'sent';
  const [targetDirty, setTargetDirty] = useState(false);
  useEffect(() => {
    setTargetDirty(false);
  }, [version.id, version.revision]);

  return (
    <div className="career-profile-screen-targeted-version-detail">
      <ActiveVersionHeader version={version} onClose={props.onClose} />
      {props.error ? (
        <p className="career-profile-screen-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <ResumeAtsView
        key={`${version.id}:${version.revision}`}
        document={props.document}
        draft={props.draft}
        initialTarget={{
          title: version.title,
          requirements: version.requirements,
          slice: version.snapshot,
        }}
        onSaveTarget={canEdit ? props.onSave : undefined}
        onTargetDirtyChange={setTargetDirty}
        savingTarget={props.saving || props.approving}
        saveTargetError={props.error}
        readOnlyTarget={!canEdit}
      />
      {version.status === 'draft' ? (
        <ResumeVersionApprovalAction
          busy={props.approving}
          disabled={props.saving || props.approving}
          dirty={targetDirty}
          onApprove={props.onApprove}
        />
      ) : null}
      <ProfileAtsAssessment
        id="sec-targeted-version-ats"
        assessment={props.assessment}
        loading={props.assessmentLoading}
        error={props.assessmentError}
      />
    </div>
  );
}
