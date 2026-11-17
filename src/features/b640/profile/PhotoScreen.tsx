import { useRef, useState, type ChangeEvent } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import { useCandidateMediaSrc } from '../../resume/candidateMediaSrc';
import { getResumeStudio } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import { Button, Icon, Link, ResultLine } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { PROFILE_CHANGED } from './ExperienceEditScreen';
import {
  photoFileError,
  preparePhoto,
  removePhoto,
  UNREADABLE_PHOTO,
  uploadPhoto,
} from './profileExtrasApi';

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

type Work =
  | { readonly step: 'idle' }
  | { readonly step: 'upload' | 'remove' }
  | { readonly step: 'done'; readonly text: string }
  | { readonly step: 'error'; readonly message: string };

/** Загрузка и удаление фото; после успеха профиль и шапка перечитываются. */
function usePhotoWork(onChanged: () => void) {
  const [work, setWork] = useState<Work>({ step: 'idle' });

  async function run(step: 'upload' | 'remove', action: () => Promise<unknown>, done: string) {
    setWork({ step });
    try {
      await action();
      forgetSharedRead('resume');
      window.dispatchEvent(new Event(PROFILE_CHANGED));
      setWork({ step: 'done', text: done });
      onChanged();
    } catch (reason) {
      const fallback = step === 'upload' ? 'Не удалось загрузить фото.' : 'Не удалось убрать фото.';
      const unreadable = reason instanceof Error && reason.message === UNREADABLE_PHOTO;
      setWork({
        step: 'error',
        message: unreadable ? UNREADABLE_PHOTO : apiErrorMessage(reason, fallback),
      });
    }
  }

  function upload(file: File) {
    const refused = photoFileError(file);
    if (refused) setWork({ step: 'error', message: refused });
    else void run('upload', async () => uploadPhoto(await preparePhoto(file)), 'Фото обновлено');
  }

  return { work, upload, remove: () => void run('remove', removePhoto, 'Фото убрано') };
}

function WorkLine({ work }: { readonly work: Work }) {
  if (work.step === 'upload' || work.step === 'remove') {
    return (
      <p className="ph-st" role="status">
        <Icon name="upload" />
        {work.step === 'upload' ? 'Загружаем…' : 'Убираем…'}
      </p>
    );
  }
  if (work.step === 'error') {
    return (
      <p className="st-var-line" role="alert">
        <Icon name="warn" />
        <span>{work.message}</span>
      </p>
    );
  }
  return work.step === 'done' ? <ResultLine text={work.text} /> : null;
}

function CurrentPhoto({ src }: { readonly src: string | undefined }) {
  if (!src) return <p className="mod-text">Фото пока нет</p>;
  return (
    <div className="ph-crop">
      <img className="ph-big" src={src} alt="Текущее фото" width={144} height={144} />
    </div>
  );
}

interface EditorProps {
  readonly photoMediaId: string | null;
  readonly onChanged: () => void;
}

function PhotoEditor({ photoMediaId, onChanged }: EditorProps) {
  const input = useRef<HTMLInputElement>(null);
  const src = useCandidateMediaSrc(photoMediaId ?? undefined);
  const { work, upload, remove } = usePhotoWork(onChanged);
  const busy = work.step === 'upload' || work.step === 'remove';

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) upload(file);
  }

  return (
    <>
      <CurrentPhoto src={src} />
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
          busy={work.step === 'upload'}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          Загрузить
        </Button>
        {photoMediaId ? (
          <Button
            variant="danger"
            icon="trash"
            busy={work.step === 'remove'}
            disabled={busy}
            onClick={remove}
          >
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

/** p08 «Фото»: своё фото профиля — загрузить, заменить, убрать (B666). */
export function PhotoScreen({ node }: { readonly node: B640Node }) {
  const photo = useLoad(loadPhoto);
  return (
    <div className="page pf" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="lead" aria-labelledby="ph-t">
          <h2 className="lead-title is-long" id="ph-t">
            Фото профиля
          </h2>
          {photo.state === 'loading' ? <BlockSkeleton label="Загружаем фото" /> : null}
          {photo.state === 'error' ? (
            <BlockError text="Не удалось загрузить профиль." onRetry={photo.retry} />
          ) : null}
          {photo.state === 'ready' && photo.data.hasProfile ? (
            <PhotoEditor photoMediaId={photo.data.photoMediaId} onChanged={photo.retry} />
          ) : null}
          {photo.state === 'ready' && !photo.data.hasProfile ? <NoProfile /> : null}
        </section>
      </div>
    </div>
  );
}
