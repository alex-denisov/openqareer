import { useRef, type ChangeEvent } from 'react';
import { useCandidateMediaSrc } from '../../resume/candidateMediaSrc';
import { getResumeStudio } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import { Button, Dialog, Icon, Link, useToast } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { ProfileScreen } from './ProfileScreen';
import { usePhotoDraft, type PhotoStep } from './usePhotoDraft';

interface PhotoProfile {
  readonly hasProfile: boolean;
  readonly photoMediaId: string | null;
}

async function loadPhoto(): Promise<PhotoProfile> {
  forgetSharedRead('resume');
  const view = await getResumeStudio();
  return {
    hasProfile: view.draft !== null,
    photoMediaId: view.draft?.candidate.photoMediaId ?? null,
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

interface EditorProps {
  readonly photoMediaId: string | null;
  readonly draft: ReturnType<typeof usePhotoDraft>;
}

function PhotoEditor({ photoMediaId, draft }: EditorProps) {
  const input = useRef<HTMLInputElement>(null);
  const saved = useCandidateMediaSrc(photoMediaId ?? undefined);
  const { pending, work } = draft;
  const shown =
    pending?.kind === 'file' ? pending.preview : pending?.kind === 'remove' ? null : saved;
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
      <div className="ph-acts">
        <Button
          icon="upload"
          busy={work.step === 'reading'}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          Загрузить
        </Button>
        {shown ? (
          <Button variant="danger" icon="trash" disabled={busy} onClick={draft.remove}>
            Убрать фото
          </Button>
        ) : null}
      </div>
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

/** Окно «Фото профиля»: изменения уходят на сервер по «Сохранить», «Отмена» возвращает в профиль. */
function PhotoDialog({ onClose }: { readonly onClose: () => void }) {
  const photo = useLoad(loadPhoto);
  const toast = useToast();
  const draft = usePhotoDraft((text) => {
    toast.show({ text });
    onClose();
  });
  const ready = photo.state === 'ready' && photo.data.hasProfile;
  const footer = ready ? (
    <>
      <Button
        variant="primary"
        icon="check"
        busy={draft.work.step === 'saving'}
        disabled={!draft.pending}
        onClick={draft.save}
      >
        Сохранить
      </Button>
      <Button variant="quiet" icon="close" onClick={onClose}>
        Отмена
      </Button>
    </>
  ) : undefined;
  return (
    <Dialog open title="Фото профиля" onClose={onClose} footer={footer}>
      {photo.state === 'loading' ? <BlockSkeleton label="Загружаем фото" /> : null}
      {photo.state === 'error' ? (
        <BlockError text="Не удалось загрузить профиль." onRetry={photo.retry} />
      ) : null}
      {ready ? <PhotoEditor photoMediaId={photo.data.photoMediaId} draft={draft} /> : null}
      {photo.state === 'ready' && !photo.data.hasProfile ? <NoProfile /> : null}
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
