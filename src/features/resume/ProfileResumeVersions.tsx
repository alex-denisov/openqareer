import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { CandidateMemory } from '../coach/coachApi';
import type {
  ResumeVersionSummary,
  StoredResumeVersion,
} from '../../../server/domain/resumeVersions';
import type { ResumeAtsAssessment } from '../../../server/domain/resumeAtsAssessment';
import type { ResumeDraft, ResumeStudioView } from './resumeTypes';
import { ResumeAtsView, parseRequirementLines } from './ResumeAtsView';
import { ResumePrintAction } from './ResumePrintAction';
import { ResumePrintDocument } from './ResumePrintDocument';
import { previewProjection, selectDocument } from './resumeStudioModel';
import {
  ActiveVersionPanel,
  announceVersionCollectionChange,
  resumeVersionErrorMessage,
  useUpdateResumeVersion,
  versionStatus,
  versionSummary,
} from './ProfileResumeVersionDetail';
export { ActiveVersionPanel };
import { getResumeAtsAssessment, getResumeVersion, getResumeVersions } from './resumeVersionsApi';
import type { ResumeVersionCreateInput } from './resumeVersionsApi';
import { createResumeVersion } from './resumeVersionsApi';

type TargetedVersion = ResumeVersionSummary;

const FORMATTED_TARGET_VERSION_TITLE = /^Под вакансию «[^«»]+»$/u;

export function formatTargetedVersionTitle(title: string): string {
  return FORMATTED_TARGET_VERSION_TITLE.test(title) ? title : `Под вакансию «${title}»`;
}

function formatVersionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'дата неизвестна' : date.toLocaleDateString('ru-RU');
}

function createVersionIdempotencyKey(): string {
  const secureCrypto = globalThis.crypto;
  if (!secureCrypto?.getRandomValues) {
    throw new Error(
      'Не удалось создать идентификатор запроса. Обновите браузер и повторите действие.',
    );
  }
  if (typeof secureCrypto.randomUUID === 'function') return secureCrypto.randomUUID();
  const bytes = secureCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function dateSummary(draft: ResumeDraft): string {
  const count = draft.experience.length;
  if (!count) return 'Места работы ещё не добавлены.';
  const complete = draft.experience.every((entry) =>
    Boolean(entry.startDate && (entry.current || entry.endDate)),
  );
  return complete
    ? `${pluralRu(count, ['место', 'места', 'мест'])}, без пропусков по датам.`
    : 'Проверьте даты начала и окончания мест работы.';
}

function AtsPlainTextDetails({
  document,
  draft,
}: {
  readonly document: ReturnType<typeof selectDocument>;
  readonly draft: ResumeDraft;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="career-profile-screen-ats-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Открыть ATS Plain Text и подготовить целевой срез</summary>
      {open ? <ResumeAtsView document={document} draft={draft} /> : null}
    </details>
  );
}

function ResumeVersionsCardHead({
  isCreating,
  onStartCreate,
}: {
  readonly isCreating: boolean;
  readonly onStartCreate: () => void;
}) {
  return (
    <div className="career-profile-screen-section-head">
      <h2 id="sec-documents-title">Резюме и версии</h2>
      {!isCreating ? (
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          data-testid="create-targeted-version-btn"
          onClick={onStartCreate}
        >
          <Plus size={16} aria-hidden="true" />
          <span>Создать версию под вакансию</span>
        </button>
      ) : null}
    </div>
  );
}

function TargetedVersionTitleField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="career-profile-screen-form-field">
      <label htmlFor="targeted-version-input" className="career-field-label">
        Название вакансии
      </label>
      <input
        id="targeted-version-input"
        name="targeted-version-input"
        type="text"
        maxLength={160}
        className="career-input"
        data-testid="targeted-version-input"
        placeholder="Например, Вектор Банк"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function TargetedVersionRequirementsField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="career-profile-screen-form-field">
      <label htmlFor="targeted-version-requirements" className="career-field-label">
        Требования вакансии
      </label>
      <textarea
        id="targeted-version-requirements"
        name="targeted-version-requirements"
        className="career-input"
        data-testid="targeted-version-requirements"
        rows={5}
        maxLength={8_000}
        placeholder="По одному пункту в строке"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="career-profile-screen-quality-note">
        Совпадения проверяются по точным словам; новые навыки и факты не добавляются.
      </p>
    </div>
  );
}

function TargetedVersionFields({
  title,
  requirementsText,
  onTitle,
  onRequirements,
}: {
  readonly title: string;
  readonly requirementsText: string;
  readonly onTitle: (value: string) => void;
  readonly onRequirements: (value: string) => void;
}) {
  return (
    <>
      <TargetedVersionTitleField value={title} onChange={onTitle} />
      <TargetedVersionRequirementsField value={requirementsText} onChange={onRequirements} />
    </>
  );
}

function versionFormValidationError(title: string, requirements: readonly string[]): string | null {
  if (!title.trim()) return 'Укажите название вакансии.';
  if (!requirements.length) return 'Добавьте хотя бы одно требование вакансии.';
  if (requirements.length > 50 || requirements.some((item) => item.length > 160)) {
    return 'Укажите не более 50 требований, до 160 символов каждое.';
  }
  return null;
}

function TargetedVersionFormFeedback({
  error,
  canCreate,
}: {
  readonly error: string | null;
  readonly canCreate: boolean;
}) {
  return (
    <>
      {error ? (
        <p className="career-profile-screen-error" role="alert">
          {error}
        </p>
      ) : null}
      {!canCreate ? (
        <p className="career-profile-screen-quality-note" role="status">
          Загружаем текущую версию мастер-резюме.
        </p>
      ) : null}
    </>
  );
}

function TargetedVersionFormActions({
  isSaving,
  canCreate,
  onCancel,
}: {
  readonly isSaving: boolean;
  readonly canCreate: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <div className="career-profile-screen-form-actions">
      <button
        type="submit"
        className="career-primary-button career-btn-sm"
        data-testid="submit-targeted-version-btn"
        disabled={isSaving || !canCreate}
      >
        {isSaving ? 'Сохраняем…' : 'Сохранить снимок'}
      </button>
      <button
        type="button"
        className="career-secondary-button career-btn-sm"
        onClick={onCancel}
        disabled={isSaving}
      >
        Отмена
      </button>
    </div>
  );
}

function TargetedVersionForm({
  onSubmit,
  onCancel,
  isSaving,
  canCreate,
  error,
}: {
  readonly onSubmit: (title: string, requirements: readonly string[]) => void;
  readonly onCancel: () => void;
  readonly isSaving: boolean;
  readonly canCreate: boolean;
  readonly error: string | null;
}) {
  const [title, setTitle] = useState('');
  const [requirementsText, setRequirementsText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const requirements = parseRequirementLines(requirementsText);
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = versionFormValidationError(title, requirements);
    if (validationError) return setLocalError(validationError);
    setLocalError(null);
    onSubmit(title.trim(), requirements);
  };
  return (
    <form className="career-profile-screen-version-form" onSubmit={handleSubmit}>
      <div className="career-profile-screen-ats-info">
        <h3>Снимок мастер-резюме под вакансию</h3>
      </div>
      <TargetedVersionFields
        title={title}
        requirementsText={requirementsText}
        onTitle={setTitle}
        onRequirements={setRequirementsText}
      />
      <TargetedVersionFormFeedback error={localError ?? error} canCreate={canCreate} />
      <TargetedVersionFormActions isSaving={isSaving} canCreate={canCreate} onCancel={onCancel} />
    </form>
  );
}

function TargetedVersionList({
  versions,
  onOpen,
  loadingVersionId,
}: {
  readonly versions: readonly TargetedVersion[];
  readonly onOpen: (versionId: string) => void;
  readonly loadingVersionId: string | null;
}) {
  if (!versions.length) {
    return (
      <p className="career-profile-screen-quality-note">
        Сохранённых снимков резюме под вакансию пока нет.
      </p>
    );
  }
  return (
    <div className="career-profile-screen-targeted-versions">
      {versions.map((version) => (
        <div key={version.id} className="career-profile-screen-versions-row">
          <div>
            <strong>{formatTargetedVersionTitle(version.title)}</strong>
            <p className="career-profile-screen-quality-note">
              {versionStatus(version.status)} · обновлено {formatVersionDate(version.updatedAt)}
            </p>
          </div>
          <button
            type="button"
            className="career-secondary-button career-btn-sm"
            aria-label={`Открыть версию ${formatTargetedVersionTitle(version.title)}`}
            data-testid={`open-targeted-version-${version.id}`}
            onClick={() => onOpen(version.id)}
            disabled={loadingVersionId !== null}
          >
            {loadingVersionId === version.id ? 'Открываем…' : 'Открыть'}
          </button>
        </div>
      ))}
    </div>
  );
}

export function VersionCreatePanel(props: {
  readonly isCreating: boolean;
  readonly onCreate: (title: string, requirements: readonly string[]) => void;
  readonly onCancel: () => void;
  readonly saving: boolean;
  readonly canCreate: boolean;
  readonly error: string | null;
}) {
  if (!props.isCreating) return null;
  return (
    <TargetedVersionForm
      onSubmit={props.onCreate}
      onCancel={props.onCancel}
      isSaving={props.saving}
      canCreate={props.canCreate}
      error={props.error}
    />
  );
}

function useResumeVersionList(masterUpdatedAt: string) {
  const [versions, setVersions] = useState<readonly TargetedVersion[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [currentMasterRevision, setCurrentMasterRevision] = useState<string | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const loadVersions = useCallback(
    async (cursor: string | null = null, append = false, signal?: AbortSignal) => {
      setLoadingVersions(true);
      setListError(null);
      try {
        const page = await getResumeVersions({ limit: 50, cursor, signal });
        if (signal?.aborted) return;
        setVersions((previous) => (append ? [...previous, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setCurrentMasterRevision(page.currentMasterRevision);
      } catch (error) {
        if (!signal?.aborted) setListError(resumeVersionErrorMessage(error));
      } finally {
        if (!signal?.aborted) setLoadingVersions(false);
      }
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    void loadVersions(null, false, controller.signal);
    return () => controller.abort();
  }, [loadVersions, masterUpdatedAt]);
  return {
    versions,
    setVersions,
    nextCursor,
    currentMasterRevision,
    setCurrentMasterRevision,
    loadingVersions,
    setLoadingVersions,
    listError,
    setListError,
    loadVersions,
  };
}

function useResumeVersionAssessment() {
  const [assessment, setAssessment] = useState<ResumeAtsAssessment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async (versionId: string) => {
    setAssessment(null);
    setLoading(true);
    setError(null);
    try {
      setAssessment(await getResumeAtsAssessment({ versionId }));
    } catch (reason) {
      setError(resumeVersionErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  return { assessment, setAssessment, loading, setLoading, error, setError, refresh };
}

function useCreateResumeVersion(props: {
  readonly currentMasterRevision: string | null;
  readonly loadVersions: () => Promise<void>;
  readonly setVersions: React.Dispatch<React.SetStateAction<readonly TargetedVersion[]>>;
  readonly setCurrentMasterRevision: (revision: string) => void;
  readonly setActiveVersion: (version: StoredResumeVersion) => void;
  readonly refreshAssessment: (versionId: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useCallback(
    async (title: string, requirements: readonly string[]) => {
      if (!props.currentMasterRevision)
        return setError('Текущая версия мастер-резюме ещё не загружена.');
      setSaving(true);
      setError(null);
      try {
        const input: ResumeVersionCreateInput = {
          title,
          requirements,
          expectedMasterRevision: props.currentMasterRevision,
        };
        const resource = await createResumeVersion(input, createVersionIdempotencyKey());
        props.setActiveVersion(resource.version);
        props.setCurrentMasterRevision(resource.currentMasterRevision);
        props.setVersions((previous) => [
          versionSummary(resource.version),
          ...previous.filter((item) => item.id !== resource.version.id),
        ]);
        announceVersionCollectionChange();
        await props.loadVersions();
        void props.refreshAssessment(resource.version.id);
      } catch (reason) {
        setError(resumeVersionErrorMessage(reason));
      } finally {
        setSaving(false);
      }
    },
    [props],
  );
  return { saving, error, setError, create };
}

function useOpenResumeVersion(props: {
  readonly setCurrentMasterRevision: (revision: string) => void;
  readonly setAssessment: (assessment: ResumeAtsAssessment | null) => void;
  readonly setAssessmentLoading: (loading: boolean) => void;
  readonly setAssessmentError: (error: string | null) => void;
}) {
  const [version, setVersion] = useState<StoredResumeVersion | null>(null);
  const [loadingVersionId, setLoadingVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(
    async (versionId: string) => {
      setLoadingVersionId(versionId);
      setError(null);
      setVersion(null);
      props.setAssessment(null);
      props.setAssessmentError(null);
      props.setAssessmentLoading(true);
      const [versionResult, assessmentResult] = await Promise.allSettled([
        getResumeVersion(versionId),
        getResumeAtsAssessment({ versionId }),
      ]);
      if (versionResult.status === 'fulfilled') {
        setVersion(versionResult.value.version);
        props.setCurrentMasterRevision(versionResult.value.currentMasterRevision);
      } else {
        setError(resumeVersionErrorMessage(versionResult.reason));
      }
      if (assessmentResult.status === 'fulfilled') {
        props.setAssessment(assessmentResult.value);
      } else {
        props.setAssessmentError(resumeVersionErrorMessage(assessmentResult.reason));
      }
      props.setAssessmentLoading(false);
      setLoadingVersionId(null);
    },
    [props],
  );
  const close = useCallback(() => {
    setVersion(null);
    setError(null);
    props.setAssessment(null);
    props.setAssessmentError(null);
  }, [props]);
  return { version, setVersion, loadingVersionId, error, setError, open, close };
}

function VersionListPanel(props: {
  readonly versions: readonly TargetedVersion[];
  readonly loading: boolean;
  readonly loadingVersionId: string | null;
  readonly listError: string | null;
  readonly nextCursor: string | null;
  readonly onOpen: (versionId: string) => void;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
}) {
  return (
    <>
      {props.listError ? (
        <div className="career-profile-screen-error" role="alert">
          <p>{props.listError}</p>
          <button
            type="button"
            className="career-secondary-button career-btn-sm"
            onClick={props.onRetry}
            disabled={props.loading}
          >
            Повторить
          </button>
        </div>
      ) : null}
      {props.loading && !props.versions.length ? (
        <p className="career-profile-screen-quality-note" role="status">
          Загружаем сохранённые версии…
        </p>
      ) : null}
      <TargetedVersionList
        versions={props.versions}
        onOpen={props.onOpen}
        loadingVersionId={props.loadingVersionId}
      />
      {props.nextCursor ? (
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          onClick={props.onLoadMore}
          disabled={props.loading}
        >
          Загрузить ещё версии
        </button>
      ) : null}
    </>
  );
}

function MasterResumeRow({ draft }: { readonly draft: ResumeDraft }) {
  return (
    <div className="career-profile-screen-versions-row">
      <div>
        <strong>Мастер-резюме</strong>
        <p className="career-profile-screen-quality-note">{dateSummary(draft)}</p>
      </div>
      <ResumePrintAction />
    </div>
  );
}

export interface ResumeVersionsScreenState {
  readonly isCreating: boolean;
  readonly setIsCreating: (value: boolean) => void;
  readonly document: ReturnType<typeof selectDocument>;
  readonly list: ReturnType<typeof useResumeVersionList>;
  readonly assessment: ReturnType<typeof useResumeVersionAssessment>;
  readonly active: ReturnType<typeof useOpenResumeVersion>;
  readonly create: ReturnType<typeof useCreateResumeVersion>;
  readonly update: ReturnType<typeof useUpdateResumeVersion>;
}

export function useProfileResumeVersionsState(
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
  view?: ResumeStudioView,
): ResumeVersionsScreenState {
  const [isCreating, setIsCreating] = useState(false);
  const projection = useMemo(() => previewProjection(draft, memory), [draft, memory]);
  const document = useMemo(() => selectDocument(projection, 'master'), [projection]);
  const list = useResumeVersionList(view?.savedAt?.updatedAt ?? '');
  const assessment = useResumeVersionAssessment();
  const active = useOpenResumeVersion({
    setCurrentMasterRevision: list.setCurrentMasterRevision,
    setAssessment: assessment.setAssessment,
    setAssessmentLoading: assessment.setLoading,
    setAssessmentError: assessment.setError,
  });
  const create = useCreateResumeVersion({
    currentMasterRevision: list.currentMasterRevision,
    loadVersions: list.loadVersions,
    setVersions: list.setVersions,
    setCurrentMasterRevision: list.setCurrentMasterRevision,
    setActiveVersion: active.setVersion,
    refreshAssessment: assessment.refresh,
  });
  const update = useUpdateResumeVersion({
    version: active.version,
    currentMasterRevision: list.currentMasterRevision,
    setVersion: active.setVersion,
    setVersions: list.setVersions,
    refreshAssessment: assessment.refresh,
  });
  return { isCreating, setIsCreating, document, list, assessment, active, create, update };
}

function VersionCollectionPanel({ state }: { readonly state: ResumeVersionsScreenState }) {
  const { isCreating, setIsCreating, list, active, create } = state;
  return (
    <>
      <VersionCreatePanel
        isCreating={isCreating}
        onCreate={create.create}
        onCancel={() => {
          setIsCreating(false);
          create.setError(null);
        }}
        saving={create.saving}
        canCreate={Boolean(list.currentMasterRevision) && !list.loadingVersions}
        error={create.error}
      />
      <VersionListPanel
        versions={list.versions}
        loading={list.loadingVersions}
        loadingVersionId={active.loadingVersionId}
        listError={list.listError}
        nextCursor={list.nextCursor}
        onOpen={(id) => void active.open(id)}
        onRetry={() => void list.loadVersions()}
        onLoadMore={() => void list.loadVersions(list.nextCursor, true)}
      />
    </>
  );
}

function ResumeVersionsCard({
  draft,
  state,
}: {
  readonly draft: ResumeDraft;
  readonly state: ResumeVersionsScreenState;
}) {
  const { isCreating, setIsCreating, document, active, assessment, update } = state;
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section career-profile-screen-versions"
      id="sec-documents"
      aria-labelledby="sec-documents-title"
    >
      <ResumeVersionsCardHead isCreating={isCreating} onStartCreate={() => setIsCreating(true)} />
      <MasterResumeRow draft={draft} />
      <VersionCollectionPanel state={state} />
      {active.version ? (
        <ActiveVersionPanel
          version={active.version}
          document={document}
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
      ) : null}
      <AtsPlainTextDetails document={document} draft={draft} />
      <ResumePrintDocument document={document} draft={draft} />
    </section>
  );
}

export function ProfileResumeVersions({
  draft,
  memory,
  view,
}: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly view?: ResumeStudioView;
}) {
  const state = useProfileResumeVersionsState(draft, memory, view);
  return <ResumeVersionsCard draft={draft} state={state} />;
}
