import { createPortal } from 'react-dom';
import { useId, type ReactNode } from 'react';
import { hhSectionsRead, type HhResumeSections } from '../../../../../shared/hhCandidateSession';
import { isPositionTerms } from '../../../../../shared/hhPositionTerms';
import { isTauriEnvironment } from '../../../../services/desktop/desktopBridge';
import { Button, StatusLine } from '../../kit';
import { HhResumeSelect } from '../HhResumeSelect';
import { editsWord, HhEditsList } from './HhResumeEdits';
import { HhResumeSheet } from './HhResumeSheet';
import { useHhResumeEdits } from './useHhResumeEdits';
import { useHhResumes, type HhResumesState } from './useHhResumes';

export interface HhResumeStepProps {
  readonly vacancyId: string;
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

function ResumeBody({
  vacancyId,
  resumes,
}: {
  readonly vacancyId: string;
  readonly resumes: HhResumesState;
}) {
  const { edits, loading } = useHhResumeEdits(vacancyId, resumes.snapshot);
  const selected = resumes.snapshot?.selected ?? null;
  const read = selected !== null && hhSectionsRead(selected.sections) ? selected.sections : null;
  return (
    <>
      <div className="lead-head">
        <h2 className="lead-title is-long" id="rs-title">
          {edits.length > 0 ? `${editsWord(edits.length)} под эту вакансию` : 'Резюме'}
        </h2>
      </div>
      {resumes.snapshot ? (
        <HhResumeSelect
          resumes={resumes.snapshot.resumes}
          selectedId={selected?.id ?? null}
          reading={resumes.loading}
          onPick={resumes.pick}
        />
      ) : null}
      {selected && !read && !resumes.loading ? <NotRead onRetry={resumes.reread} /> : null}
      {loading ? <StatusLine state="wait" text="Готовим правки" /> : null}
      {selected && edits.length > 0 ? (
        <HhEditsList
          key={selected.id}
          resumeId={selected.id}
          resumeTitle={selected.title}
          edits={edits}
          canWrite={isTauriEnvironment()}
        />
      ) : null}
      {read ? <ResumeContent sections={read} /> : null}
    </>
  );
}

/** Шаг «Резюме» отклика на hh.ru: отклик уходит резюме hh.ru, своё резюме не готовится. */
export function HhResumeStep({ vacancyId, confirmed, onConfirm, dock }: HhResumeStepProps) {
  const resumes = useHhResumes(vacancyId);
  const selected = resumes.snapshot?.selected ?? null;
  const choose = !selected && !resumes.loading && isTauriEnvironment();
  const action = choose ? (
    <Button variant="primary" onClick={resumes.openPicker}>
      Выбрать резюме hh.ru
    </Button>
  ) : (
    <Button variant="primary" icon="check" disabled={resumes.loading} onClick={onConfirm}>
      {confirmed || !selected ? 'К письму' : 'Одобрить резюме'}
    </Button>
  );
  return (
    <section className="lead cv-lead" aria-labelledby="rs-title">
      <ResumeBody vacancyId={vacancyId} resumes={resumes} />
      {dock ? createPortal(action, dock) : <div className="actions">{action}</div>}
      <HhResumeSheet
        picker={resumes.picker}
        currentId={selected?.id ?? null}
        saving={resumes.saving}
        onClose={resumes.closePicker}
        onSignIn={resumes.signIn}
        onRetry={resumes.openPicker}
        onChoose={(item) => resumes.choose(item)}
      />
    </section>
  );
}
