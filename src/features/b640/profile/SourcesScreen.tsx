import { useRef, useState, type ChangeEvent } from 'react';
import { CoachApiError } from '../../coach/apiClient';
import { importCandidateResume } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import { extractPdfResume, PdfResumeImportError } from '../../workspace/pdfResume';
import { getConnections, type CandidateConnection } from '../../coach/coachApi';
import { BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import type { ReviewRow } from './experienceForm';
import { importedDay } from './importedDay';
import { loadReview, ReviewList } from './ReviewScreen';
import {
  ActionDock,
  Button,
  Dialog,
  Icon,
  Link,
  ResultLine,
  StatusLine,
  type IconName,
} from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { CONSULTANT_PATH } from '../shell/navigation';
import { NEW_ENTRY_ID } from './newExperience';
import { freshDraft } from './ExperienceEditScreen';

type UploadState =
  | { readonly step: 'idle' }
  | { readonly step: 'checking' | 'reading' }
  /** В профиле уже есть места работы: импорт их заменит, нужно согласие. */
  | { readonly step: 'confirm'; readonly file: File }
  | { readonly step: 'done' }
  | { readonly step: 'error'; readonly message: string };

function failureText(reason: unknown): string {
  // Эти тексты написаны для кандидата; остальные ошибки могут быть техническими.
  if (reason instanceof CoachApiError || reason instanceof PdfResumeImportError) {
    return reason.message;
  }
  return reason instanceof Error && reason.message === NOT_PDF
    ? NOT_PDF
    : 'Не удалось прочитать резюме.';
}

const NOT_PDF = 'Выберите PDF-файл.';

async function importPdf(file: File): Promise<void> {
  const extracted = await extractPdfResume(file);
  await importCandidateResume({
    text: extracted.text,
    source: 'pdf',
    fileName: extracted.fileName,
  });
  forgetSharedRead('resume');
}

/** Есть ли в профиле места работы, которые импорт заменит. Сбой чтения — считаем, что есть. */
async function profileHasExperience(): Promise<boolean> {
  try {
    return (await freshDraft()).experience.length > 0;
  } catch (reason) {
    return !(reason instanceof Error && reason.message === 'profile_draft_missing');
  }
}

interface UploadActionProps {
  readonly done: boolean;
  readonly busy: boolean;
  /** p04b: залитая кнопка на экране — «Дальше». */
  readonly primary: boolean;
  readonly onPick: () => void;
}

function UploadAction({ done, busy, primary, onPick }: UploadActionProps) {
  if (done) {
    return (
      <Link className={primary ? 'btn is-primary' : 'btn'} to={buildNodePath('p06')}>
        Проверить записи
        <Icon name="right" />
      </Link>
    );
  }
  return (
    <Button variant={primary ? 'primary' : 'default'} busy={busy} onClick={onPick}>
      Выбрать файл
      <Icon name="right" />
    </Button>
  );
}

function UploadStatus({ state }: { readonly state: UploadState }) {
  if (state.step === 'checking' || state.step === 'reading') {
    return <StatusLine state="wait" text="Читаем резюме…" />;
  }
  if (state.step === 'error') return <StatusLine state="err" text={state.message} />;
  return state.step === 'done' ? <ResultLine text="Резюме прочитано" /> : null;
}

/** Выбор файла и импорт; замену уже заполненного профиля кандидат подтверждает. */
function useUpload() {
  const [state, setState] = useState<UploadState>({ step: 'idle' });

  async function run(file: File) {
    setState({ step: 'reading' });
    try {
      await importPdf(file);
      setState({ step: 'done' });
    } catch (reason) {
      setState({ step: 'error', message: failureText(reason) });
    }
  }

  async function choose(file: File) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setState({ step: 'error', message: NOT_PDF });
      return;
    }
    setState({ step: 'checking' });
    if (await profileHasExperience()) setState({ step: 'confirm', file });
    else await run(file);
  }

  return { state, choose, run, cancel: () => setState({ step: 'idle' }) };
}

interface ReplaceDialogProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onReplace: () => void;
}

/** Импорт заменяет уже заполненный профиль: это подтверждает кандидат. */
function ReplaceDialog({ open, onCancel, onReplace }: ReplaceDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Заменить профиль данными из файла?"
      footer={
        <>
          <Button variant="quiet" icon="close" onClick={onCancel}>
            Отмена
          </Button>
          <Button variant="danger" icon="upload" onClick={onReplace}>
            Заменить
          </Button>
        </>
      }
    >
      <p className="mod-text">Места работы и навыки в профиле заменятся данными из резюме.</p>
    </Dialog>
  );
}

/** «Загрузить резюме»: PDF читается в браузере, в профиль уходит его текст. */
function UploadSource({ primary }: { readonly primary: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const { state, choose, run, cancel } = useUpload();
  const busy = state.step === 'checking' || state.step === 'reading';

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void choose(file);
  }

  return (
    <li className={primary ? 'src is-next' : 'src'}>
      <span className="src-ico">
        <Icon name="upload" />
      </span>
      <div className="src-main">
        <h3 className="src-title">Загрузить резюме</h3>
        <UploadStatus state={state} />
      </div>
      <input
        ref={input}
        className="vh"
        type="file"
        accept="application/pdf,.pdf"
        aria-hidden="true"
        tabIndex={-1}
        onChange={onFile}
      />
      <UploadAction
        done={state.step === 'done'}
        busy={busy}
        primary={primary}
        onPick={() => input.current?.click()}
      />
      <ReplaceDialog
        open={state.step === 'confirm'}
        onCancel={cancel}
        onReplace={() => state.step === 'confirm' && void run(state.file)}
      />
    </li>
  );
}

interface LinkSourceProps {
  readonly icon: IconName;
  readonly title: string;
  readonly action: string;
  readonly path: string;
}

function LinkSource({ icon, title, action, path }: LinkSourceProps) {
  return (
    <li className="src">
      <span className="src-ico">
        <Icon name={icon} />
      </span>
      <div className="src-main">
        <h3 className="src-title">{title}</h3>
      </div>
      <Link className="btn" to={path}>
        {action}
        <Icon name="right" />
      </Link>
    </li>
  );
}

const PLATFORMS = [
  { platform: 'linkedin', icon: 'linkedin', title: 'LinkedIn', node: 'a03' },
  { platform: 'hh', icon: 'brief2', title: 'hh.ru', node: 'a11' },
] as const;

/** p04b: площадка уже прочитана — «Готово · дата» и «Обновить». */
function ReadSource({
  icon,
  title,
  day,
}: Pick<LinkSourceProps, 'icon' | 'title'> & { readonly day: string | null }) {
  return (
    <li className="src is-next">
      <span className="src-ico">
        <Icon name={icon} />
      </span>
      <div className="src-main">
        <h3 className="src-title">{title}</h3>
        <ul className="src-stages">
          <li>
            Готово
            {day ? (
              <>
                {' · '}
                <span className="num">{day}</span>
              </>
            ) : null}
          </li>
        </ul>
      </div>
      <Link className="btn" to={buildNodePath('n03')} aria-label={`Обновить ${title}`}>
        <Icon name="refresh" />
        Обновить
      </Link>
    </li>
  );
}

function ReviewBlock({ rows }: { readonly rows: readonly ReviewRow[] }) {
  return (
    <section className="pr-block" aria-labelledby="pr-t">
      <h3 className="pr-block-t" id="pr-t">
        Так мы прочитали ваш профиль — всё верно?
      </h3>
      <ReviewList rows={rows} level={4} />
    </section>
  );
}

interface Sources {
  readonly connections: readonly CandidateConnection[];
  readonly rows: readonly ReviewRow[];
}

/** Не прочиталось — источники показываем как неподключённые: все пути остаются. */
async function loadSources(): Promise<Sources> {
  const connections = await getConnections().catch(() => []);
  if (!PLATFORMS.some(({ platform }) => importedDay(connections, platform) !== undefined))
    return { connections, rows: [] };
  return { connections, rows: await loadReview().catch(() => []) };
}

interface RestSourcesProps {
  readonly days: readonly ((typeof PLATFORMS)[number] & {
    readonly day: string | null | undefined;
  })[];
  /** p04b: сверху уже есть прочитанная площадка. */
  readonly hasRead: boolean;
}

function RestSources({ days, hasRead }: RestSourcesProps) {
  return (
    <ul className="src-list">
      <UploadSource primary={!hasRead} />
      {days
        .filter(({ day }) => day === undefined)
        .map(({ platform, icon, title, node: code }) => (
          <LinkSource
            key={platform}
            icon={icon}
            title={title}
            action="Подключить"
            path={buildNodePath(code)}
          />
        ))}
      <LinkSource
        icon="chat"
        title="Рассказать консультанту"
        action="Начать разговор"
        path={CONSULTANT_PATH}
      />
      <LinkSource
        icon="edit"
        title="Заполнить вручную"
        action="Заполнить"
        path={buildNodePath('p07', { entryId: NEW_ENTRY_ID })}
      />
    </ul>
  );
}

/** p04 «Откуда взять опыт» и p04b: прочитанная площадка сверху, под ней записи на проверку. */
export function SourcesScreen({ node }: { readonly node: B640Node }) {
  const load = useLoad(loadSources);
  const connections = load.state === 'ready' ? load.data.connections : [];
  const rows = load.state === 'ready' ? load.data.rows : [];
  const days = PLATFORMS.map((item) => ({ ...item, day: importedDay(connections, item.platform) }));
  const read = days.filter(({ day }) => day !== undefined);
  return (
    <div className="page pf" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="lead" aria-labelledby="pf-t">
          <h2 className="lead-title is-long" id="pf-t">
            Откуда взять опыт
          </h2>
          {load.state === 'loading' ? <BlockSkeleton label="Загружаем источники" rows={3} /> : null}
          {read.length > 0 ? (
            <ul className="src-list">
              {read.map(({ platform, icon, title, day }) => (
                <ReadSource key={platform} icon={icon} title={title} day={day ?? null} />
              ))}
            </ul>
          ) : null}
          {rows.length > 0 ? <ReviewBlock rows={rows} /> : null}
          {load.state === 'loading' ? null : <RestSources days={days} hasRead={read.length > 0} />}
          {read.length > 0 ? (
            <ActionDock
              kind="commit"
              primary={
                <Link className="btn is-primary" to={buildNodePath('s10')}>
                  <Icon name="arrow" />
                  Дальше
                </Link>
              }
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
