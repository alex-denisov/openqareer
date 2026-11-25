import { useState, type FormEvent } from 'react';
import { saveResumeStudioDraft } from '../../resume/resumeApi';
import type { ResumeDraft } from '../../resume/resumeTypes';
import { Button, Icon, Link } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { freshDraft } from './ExperienceEditScreen';
import { nextQuestion, teamAnswer, type ProfileQuestion } from './partTwoModel';
import { teamLabel } from './profileModel';

const PROFILE_PATH = buildNodePath('s01');

function loadDraft(): Promise<ResumeDraft> {
  return freshDraft();
}

type TeamAnswer = { readonly teamSize: number } | { readonly teamSizeDeclined: true };

/** Записывает ответ о команде в свежепрочитанный профиль: чужие правки не затираются. */
async function saveAnswer(entryId: string, answer: TeamAnswer): Promise<void> {
  const draft = await freshDraft();
  if (!draft.experience.some((entry) => entry.id === entryId)) throw new Error('entry_missing');
  await saveResumeStudioDraft({
    ...draft,
    experience: draft.experience.map((entry) =>
      entry.id === entryId ? { ...entry, ...answer } : entry,
    ),
  });
}

interface Answered {
  readonly entryId: string;
  readonly text: string;
}

interface AskProps {
  readonly question: ProfileQuestion;
  readonly onAnswered: (answered: Answered) => void;
  readonly onDeclined: () => void;
}

interface AskFieldProps {
  readonly label: string;
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}

function AskField({ label, value, error, onChange }: AskFieldProps) {
  return (
    <div className="field pf-ask">
      <label htmlFor="tm9">{label}</label>
      <input
        id="tm9"
        type="text"
        inputMode="numeric"
        placeholder="примерно, например 9"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'tm9-e' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <small className="is-err" id="tm9-e">
          <Icon name="warn" />
          {error}
        </small>
      ) : null}
    </div>
  );
}

interface AskActionsProps {
  readonly busy: boolean;
  readonly onDecline: () => void;
}

function AskActions({ busy, onDecline }: AskActionsProps) {
  return (
    <div className="actions">
      <Button type="submit" variant="primary" icon="check" busy={busy}>
        Ответить
      </Button>
      <Link className="btn is-quiet" to={PROFILE_PATH}>
        <Icon name="clock" />
        Не сейчас
      </Link>
      <Button variant="quiet" icon="eyeoff" disabled={busy} onClick={onDecline}>
        Не хочу указывать
      </Button>
    </div>
  );
}

function answeredWith({ entryId, employer }: ProfileQuestion, size: number): Answered {
  const place = employer ? ` в «${employer}»` : '';
  return { entryId, text: `Записано: команда${place} — ${teamLabel(size)}` };
}

function Ask({ question, onAnswered, onDeclined }: AskProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(answer: TeamAnswer, onSaved: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveAnswer(question.entryId, answer);
      onSaved();
    } catch {
      setError('Ответ не сохранился');
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const size = teamAnswer(text);
    if (busy) return;
    if (size === null) setError('Только число');
    else void send({ teamSize: size }, () => onAnswered(answeredWith(question, size)));
  }

  return (
    <form noValidate onSubmit={submit}>
      <AskField
        label={question.text}
        value={text}
        error={error}
        onChange={(value) => {
          setText(value);
          setError(null);
        }}
      />
      <AskActions busy={busy} onDecline={() => void send({ teamSizeDeclined: true }, onDeclined)} />
    </form>
  );
}

function NoQuestions() {
  return (
    <>
      <p className="mod-text">Вопросов о профиле сейчас нет</p>
      <div className="actions">
        <Link className="btn" to={PROFILE_PATH}>
          <Icon name="back" />
          Открыть профиль
        </Link>
      </div>
    </>
  );
}

/** p09 «Уточнение профиля»: один вопрос, ответ сразу записывается в профиль. */
export function QuestionScreen({ node }: { readonly node: B640Node }) {
  const draft = useLoad(loadDraft);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const question = draft.state === 'ready' ? nextQuestion(draft.data) : null;
  return (
    <div className="page pf" data-b640-node={node.code} data-b640-section={node.section}>
      {answered ? (
        <p className="pf-done col-wide" role="status">
          <Icon name="checkc" />
          {answered.text}
          <Link className="row-act" to={buildNodePath('p07', { entryId: answered.entryId })}>
            Изменить
          </Link>
        </p>
      ) : null}
      <div className="col">
        <section className="lead" aria-labelledby="pf-t">
          <h2 className="lead-title is-long" id="pf-t">
            Уточнение профиля: один вопрос
          </h2>
          {draft.state === 'loading' ? <BlockSkeleton label="Загружаем вопрос" /> : null}
          {draft.state === 'error' ? (
            <BlockError text="Не удалось загрузить вопрос." onRetry={draft.retry} />
          ) : null}
          {draft.state === 'ready' && question && question.entryId !== answered?.entryId ? (
            <Ask
              key={question.entryId}
              question={question}
              onAnswered={(next) => {
                setAnswered(next);
                draft.retry();
              }}
              onDeclined={() => {
                setAnswered(null);
                draft.retry();
              }}
            />
          ) : null}
          {draft.state === 'ready' && !question ? <NoQuestions /> : null}
        </section>
      </div>
    </div>
  );
}
