import { useRef, type ChangeEvent } from 'react';
import { useCandidateMediaSrc } from '../../resume/candidateMediaSrc';
import { getResumeStudio } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import { Button, Dialog, Icon, Link, useToast } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { PhotoInResumeSwitch } from './PhotoInResume';
import { getResumePhoto } from './profileExtrasApi';
import { ProfileScreen } from './ProfileScreen';
import { usePhotoDraft, type PhotoStep } from './usePhotoDraft';

interface PhotoProfile {
  readonly hasProfile: boolean;
  readonly photoMediaId: string | null;
  /** Фото из последнего импорта LinkedIn; `null` — из LinkedIn не импортировали. */
  readonly linkedinPhotoMediaId: string | null;
  readonly inResume: boolean;
}

async function loadPhoto(signal: AbortSignal): Promise<PhotoProfile> {
  forgetSharedRead('resume');
  const [view, setting] = await Promise.all([getResumeStudio(), getResumePhoto(signal)]);
  const candidate = view.draft?.candidate;
  return {
    hasProfile: view.draft !== null,
    photoMediaId: candidate?.photoMediaId ?? null,
    linkedinPhotoMediaId: candidate?.linkedinPhotoMediaId ?? null,
    inResume: setting.inResume,
  };
}

function WorkLine({ work }: { readonly work: PhotoStep }) {
  if (work.step === 'reading' || work.step === 'saving') {
    return (
      <p className="ph-st" role="status">
        <Icon name="upload" />
        {work.step === 'reading' ? 'Готовим фото…' : 'Сохраняем…'}
      </p>
    );
  }
  if (work.step !== 'error') return null;
  return (
    <p className="st-var-line" role="alert">
      <Icon name="warn" />
      <span>{work.message}</span>
    </p>
  );
}

function CurrentPhoto({ src }: { readonly src: string | null | undefined }) {
  if (!src) return <p className="mod-text">Фото пока нет</p>;
  return (
    <div className="ph-crop">
      <img
        className="ph-big"
        src={src}
        alt="Фото профиля, обрезка кругом"
        width={144}
        height={144}
      />
    </div>
  );
}

type PhotoDraft = ReturnType<typeof usePhotoDraft>;

function shownPhoto(
  pending: PhotoDraft['pending'],
  saved: string | undefined,
  linkedin: string | undefined,
) {
  if (pending?.kind === 'file') return pending.preview;
  if (pending?.kind === 'linkedin') return linkedin;
  return pending?.kind === 'remove' ? null : saved;
}

interface ActionsProps {
  readonly draft: PhotoDraft;
  readonly linkedinId: string | null;
  readonly hasPhoto: boolean;
  readonly onUpload: () => void;
}

/** «Взять из LinkedIn» — только после импорта из LinkedIn, где было фото. */
function PhotoActions({ draft, linkedinId, hasPhoto, onUpload }: ActionsProps) {
  const busy = draft.work.step === 'reading' || draft.work.step === 'saving';
  return (
    <div className="ph-acts">
      {linkedinId ? (
        <Button icon="linkedin" disabled={busy} onClick={() => draft.takeLinkedin(linkedinId)}>
          Взять из LinkedIn
        </Button>
      ) : null}
      <Button icon="upload" busy={draft.work.step === 'reading'} disabled={busy} onClick={onUpload}>
        Загрузить
      </Button>
      {hasPhoto ? (
        <button
          className="btn is-quiet is-danger"
          type="button"
          disabled={busy}
          onClick={draft.remove}
        >
          <Icon name="trash" />
          Убрать фото
        </button>
      ) : null}
    </div>
  );
}

interface EditorProps {
  readonly profile: PhotoProfile;
  readonly draft: PhotoDraft;
}

function PhotoEditor({ profile, draft }: EditorProps) {
  const input = useRef<HTMLInputElement>(null);
  const saved = useCandidateMediaSrc(profile.photoMediaId ?? undefined);
  const linkedin = useCandidateMediaSrc(profile.linkedinPhotoMediaId ?? undefined);
  const { pending, work } = draft;
  const shown = shownPhoto(pending, saved, linkedin);
  const busy = work.step === 'reading' || work.step === 'saving';

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) draft.pick(file);
  }

  return (
    <>
      <CurrentPhoto src={shown} />
      <WorkLine work={work} />
      <input
        ref={input}
        className="vh"
        type="file"
        accept="image/jpeg,image/png"
        aria-hidden="true"
        tabIndex={-1}
        onChange={onFile}
      />
      <PhotoActions
        draft={draft}
        linkedinId={profile.linkedinPhotoMediaId}
        hasPhoto={Boolean(shown)}
        onUpload={() => input.current?.click()}
      />
      <PhotoInResumeSwitch
        id="ph-cv"
        checked={draft.inResume}
        disabled={busy}
        onChange={draft.setInResume}
      />
    </>
  );
}

function NoProfile() {
  return (
    <>
      <p className="mod-text">Сначала добавьте в профиль опыт</p>
      <div className="actions">
        <Link className="btn" to={buildNodePath('p04')}>
          <Icon name="plus" />
          Добавить опыт
        </Link>
      </div>
    </>
  );
}

function Footer({ draft, onClose }: { readonly draft: PhotoDraft; readonly onClose: () => void }) {
  return (
    <>
      <Button
        variant="primary"
        icon="check"
        busy={draft.work.step === 'saving'}
        disabled={!draft.changed}
        onClick={draft.save}
      >
        Сохранить
      </Button>
      <Button variant="quiet" icon="close" onClick={onClose}>
        Отмена
      </Button>
    </>
  );
}

/** Окно «Фото профиля»: изменения уходят по «Сохранить», «Отмена» ничего не меняет. */
function PhotoDialog({ onClose }: { readonly onClose: () => void }) {
  const photo = useLoad(loadPhoto);
  const toast = useToast();
  const ready = photo.state === 'ready' && photo.data.hasProfile ? photo.data : null;
  const draft = usePhotoDraft(ready?.inResume ?? null, (text) => {
    toast.show({ text });
    onClose();
  });
  return (
    <Dialog
      open
      title="Фото профиля"
      onClose={onClose}
      footer={ready ? <Footer draft={draft} onClose={onClose} /> : undefined}
    >
      {photo.state === 'loading' ? <BlockSkeleton label="Загружаем фото" /> : null}
      {photo.state === 'error' ? (
        <BlockError text="Не удалось загрузить профиль." onRetry={photo.retry} />
      ) : null}
      {ready ? <PhotoEditor profile={ready} draft={draft} /> : null}
      {photo.state === 'ready' && !ready ? <NoProfile /> : null}
    </Dialog>
  );
}

/** p08 «Фото» по макету: окно над «Профилем», на 390 — нижний лист (B666, B645). */
export function PhotoScreen({ node }: { readonly node: B640Node }) {
  const { navigate } = useShell();
  return (
    <>
      <ProfileScreen node={node} />
      <PhotoDialog onClose={() => navigate(buildNodePath('s01'))} />
    </>
  );
}
