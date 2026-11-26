import { createPortal } from 'react-dom';
import { useId, type ReactNode } from 'react';
import { hhSectionsRead, type HhResumeSections } from '../../../../../shared/hhCandidateSession';
import { isPositionTerms } from '../../../../../shared/hhPositionTerms';
import { isTauriEnvironment } from '../../../../services/desktop/desktopBridge';
import { Button, StatusLine } from '../../kit';
import { HhResumeSelect } from '../HhResumeSelect';
import { editsWord, HhEditsList } from './HhResumeEdits';
import { HhResumeSheet } from './HhResumeSheet';
import { showHhCaptcha } from './hhDesktop';
import { useHhHiddenCopy, useHhMissing, type HhHiddenCopy } from './useHhHiddenCopy';
import { useHhResumeEdits, type HhResumeEditsState } from './useHhResumeEdits';
import { useHhResumes, type HhResumesState } from './useHhResumes';

export interface HhResumeStepProps {
  readonly vacancyId: string;
  /** Должность вакансии: ею называется резюме под вакансию. */
  readonly vacancyTitle: string;
  readonly confirmed: boolean;
  readonly onConfirm: () => void;
  /** Полоса действия страницы (макет o03, от 768); без неё кнопка стоит под резюме. */
  readonly dock: HTMLElement | null;
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <section className="hh2-sec" aria-labelledby={id}>
      <h3 className="mod-title" id={id}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Text({ text }: { readonly text: string }) {
  return (
    <p className="hh2-now">
      {text.split('\n').map((line, index) => (
        <span className="hh2-line" key={`${index}-${line.slice(0, 16)}`}>
          {line}
        </span>
      ))}
    </p>
  );
}

/** Резюме так, как его прочитали на hh.ru. */
function ResumeContent({ sections }: { readonly sections: HhResumeSections }) {
  return (
    <>
      <Section title="Должность">
        <Text text={sections.title} />
      </Section>
      <Section title="Опыт по местам">
        <ul className="hh2-rows">
          {sections.places.map((place, index) => (
            <li className="hh2-r" key={`${index}-${place.employer}`}>
              <p className="hh2-place">
                {[place.employer, place.title, place.period].filter(Boolean).join(' · ')}
              </p>
              {place.text ? <Text text={place.text} /> : null}
            </li>
          ))}
        </ul>
      </Section>
      {sections.skills.length > 0 ? (
        <Section title="Навыки">
          <Text text={sections.skills.join(', ')} />
        </Section>
      ) : null}
      {sections.about && !isPositionTerms(sections.about) ? (
        <Section title="О себе">
          <Text text={sections.about} />
        </Section>
      ) : null}
    </>
  );
}

function NotRead({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <StatusLine
      state="err"
      text="Резюме hh.ru не прочиталось"
      action={
        isTauriEnvironment() ? (
          <Button size="sm" onClick={onRetry}>
            Повторить
          </Button>
        ) : undefined
      }
    />
  );
}

/** B787: сверка с вакансией и ход создания резюме под неё. */
function CopyStatus({ copy, missing, ready }: { readonly copy: HhHiddenCopy; readonly missing: readonly string[]; readonly ready: boolean }) {
  const { state } = copy;
  if (state.kind === 'running') return <StatusLine state="wait" text={state.text} />;
  if (state.kind === 'failed') {
    const open = (
      <button className="res-act" type="button" onClick={() => void showHhCaptcha()}>
        Открыть окно hh.ru
      </button>
    );
    return <StatusLine state="err" text={state.text} action={state.window ? open : undefined} />;
  }
  if (ready) return <StatusLine state="ok" text="Создано под вакансию, на hh.ru не видно никому" />;
  return missing.length > 0 ? <StatusLine state="err" text={`Не хватает: ${missing.join(', ')}`} /> : null;
}

interface ResumeBodyProps {
  readonly resumes: HhResumesState;
  readonly edits: HhResumeEditsState;
  readonly copy: HhHiddenCopy;
  readonly missing: readonly string[];
  readonly copyReady: boolean;
  /** Выбранное резюме можно править на hh.ru. */
  readonly canWrite: boolean;
}

function ResumeBody({ resumes, edits: { edits, loading, failed, retry }, copy, missing, copyReady, canWrite }: ResumeBodyProps) {
  const selected = resumes.snapshot?.selected ?? null;
  const read = selected !== null && hhSectionsRead(selected.sections) ? selected.sections : null;
  const running = copy.state.kind === 'running';
  return (
    <>
      <div className="lead-head">
        <h2 className="lead-title is-long" id="rs-title">
          {edits.length > 0 ? `${editsWord(edits.length)} под эту вакансию` : 'Резюме'}
        </h2>
      </div>
      {resumes.snapshot && !running ? (
        <HhResumeSelect
          resumes={resumes.snapshot.resumes}
          selectedId={selected?.id ?? null}
          reading={resumes.loading}
          onPick={resumes.pick}
        />
      ) : null}
      <CopyStatus copy={copy} missing={missing} ready={copyReady} />
      {selected && !read && !resumes.loading ? <NotRead onRetry={resumes.reread} /> : null}
      {loading && !running ? <StatusLine state="wait" text="Готовим правки" /> : null}
      {failed && !running ? (
        <StatusLine
          state="err"
          text="Правки под вакансию не подготовились."
          action={
            <button className="res-act" type="button" onClick={retry}>
              Повторить
            </button>
          }
        />
      ) : null}
      {selected && edits.length > 0 ? (
        <HhEditsList
          key={selected.id}
          resumeId={selected.id}
          resumeTitle={selected.title}
          edits={edits}
          canWrite={canWrite && !running}
        />
      ) : null}
      {read ? <ResumeContent sections={read} /> : null}
    </>
  );
}

interface ActionsProps {
  readonly resumes: HhResumesState;
  readonly copy: HhHiddenCopy;
  /** Выбранное резюме не подходит: предлагается резюме под вакансию. */
  readonly offer: boolean;
  /** Копия этой вакансии начата и не готова: ею не откликаемся. */
  readonly unfinished: boolean;
  readonly confirmed: boolean;
  readonly onConfirm: () => void;
}

function StepActions({ resumes, copy, offer, unfinished, confirmed, onConfirm }: ActionsProps) {
  const selected = resumes.snapshot?.selected ?? null;
  if (!selected && !resumes.loading && isTauriEnvironment()) {
    return (
      <Button variant="primary" onClick={resumes.openPicker}>
        Выбрать резюме hh.ru
      </Button>
    );
  }
  const running = copy.state.kind === 'running';
  const failed = copy.state.kind === 'failed' ? copy.state : null;
  const create = (offer || unfinished || failed !== null) && failed?.retry !== false;
  return (
    <>
      {create ? (
        <Button variant="primary" busy={running} disabled={running || resumes.loading} onClick={copy.create}>
          {failed ? 'Повторить' : unfinished ? 'Продолжить создание' : 'Создать резюме под вакансию'}
        </Button>
      ) : null}
      {unfinished ? null : (
        <Button variant={create ? 'quiet' : 'primary'} icon="check" disabled={resumes.loading || running} onClick={onConfirm}>
          {confirmed || !selected ? 'К письму' : 'Одобрить резюме'}
        </Button>
      )}
    </>
  );
}

/** Шаг «Резюме» отклика на hh.ru: отклик уходит резюме hh.ru, своё резюме не готовится. */
export function HhResumeStep({ vacancyId, vacancyTitle, confirmed, onConfirm, dock }: HhResumeStepProps) {
  const resumes = useHhResumes(vacancyId);
  const { snapshot } = resumes;
  const edits = useHhResumeEdits(vacancyId, snapshot);
  const missing = useHhMissing(vacancyId, snapshot);
  const copy = useHhHiddenCopy(vacancyId, vacancyTitle, snapshot, resumes.replace);
  const selectedId = snapshot?.selected?.id ?? null;
  // B787: копия начата, а её id ещё не подтверждён — она «за» исходным резюме: продолжить, а не начать заново.
  const ownCopy =
    snapshot?.copy && (snapshot.copy.copyId === selectedId || (!snapshot.copy.copyId && snapshot.copy.sourceId === selectedId))
      ? snapshot.copy
      : null;
  // Править нечем — новое резюме повторило бы прежнее.
  const offer = isTauriEnvironment() && !ownCopy && missing.length > 0 && edits.edits.length > 0;
  const action = (
    <StepActions
      resumes={resumes}
      copy={copy}
      offer={offer}
      unfinished={ownCopy !== null && ownCopy.stage !== 'ready'}
      confirmed={confirmed}
      onConfirm={onConfirm}
    />
  );
  return (
    <section className="lead cv-lead" aria-labelledby="rs-title">
      <ResumeBody
        resumes={resumes}
        edits={edits}
        copy={copy}
        missing={missing}
        copyReady={ownCopy?.stage === 'ready'}
        canWrite={isTauriEnvironment() && !offer && !ownCopy}
      />
      {dock ? createPortal(action, dock) : <div className="actions">{action}</div>}
      <HhResumeSheet
        picker={resumes.picker}
        currentId={selectedId}
        saving={resumes.saving}
        onClose={resumes.closePicker}
        onSignIn={resumes.signIn}
        onRetry={resumes.openPicker}
        onChoose={(item) => resumes.choose(item)}
      />
    </section>
  );
}
