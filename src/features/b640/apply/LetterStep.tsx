import { useId } from 'react';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import { Button, Icon, ResultLine, StatusLine } from '../kit';
import {
  COLD_RECIPIENT,
  recipientOptions,
  type ApplyHead,
  type RecipientOption,
} from './model/applyModel';

const TONES = [
  { value: 'executive', label: 'Деловой' },
  { value: 'confident', label: 'Тёплый' },
  { value: 'technical', label: 'Технический' },
] as const;
const LANGUAGES = [
  { value: 'auto', label: 'Определить по вакансии' },
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
] as const;
const LANGUAGE_NAMES = { ru: 'русский', en: 'English' } as const;

interface RecipientProps {
  readonly letter: LetterScreenState;
  readonly options: readonly RecipientOption[];
}

/** «Кому»: работодателю напрямую или через знакомого. Один адресат — выбора нет. */
function Recipient({ letter, options }: RecipientProps) {
  const id = useId();
  if (options.length < 2) return null;
  const value = letter.circle.selectedPathId ?? COLD_RECIPIENT;
  return (
    <div className="lt-to">
      <label className="lt-to-l" htmlFor={id}>
        Кому
      </label>
      <select
        id={id}
        value={options.some((option) => option.value === value) ? value : COLD_RECIPIENT}
        onChange={(event) => {
          const picked = options.find((option) => option.value === event.currentTarget.value);
          if (!picked) return;
          letter.circle.setCircle(picked.circle);
          letter.circle.setSelectedPathId(picked.pathId);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToneAndLanguage({ letter }: { readonly letter: LetterScreenState }) {
  const id = useId();
  const tone = TONES.find((item) => item.value === letter.tone)?.label ?? TONES[0].label;
  const used = letter.draft.pitch?.language;
  const language = letter.language === 'auto' ? used : letter.language;
  return (
    <details className="ls ls-chip">
      <summary className="ls-sum">
        <span>{language ? `${tone} · ${LANGUAGE_NAMES[language]}` : tone}</span>
        <Icon name="down" />
      </summary>
      <div className="ls-body">
        <div className="ls-f">
          <label className="ls-l" htmlFor={`${id}-tone`}>
            Тон
          </label>
          <select
            id={`${id}-tone`}
            value={letter.tone}
            onChange={(event) => letter.setTone(event.currentTarget.value as typeof letter.tone)}
          >
            {TONES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ls-f">
          <label className="ls-l" htmlFor={`${id}-lang`}>
            Язык
          </label>
          <select
            id={`${id}-lang`}
            value={letter.language}
            onChange={(event) =>
              letter.setLanguage(event.currentTarget.value as typeof letter.language)
            }
          >
            {LANGUAGES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </details>
  );
}

interface ApprovalProps {
  readonly letter: LetterScreenState;
  readonly onSend: () => void;
}

/** Не собрался снимок резюме: письмо не одобряется, пока резюме не готово. */
function ResumeGate({ letter }: { readonly letter: LetterScreenState }) {
  const failure = letter.approval.resumeFailure;
  if (!failure) return null;
  return (
    <StatusLine
      state="err"
      text="Резюме под эту вакансию не собралось"
      action={
        <>
          {failure.retried ? null : (
            <Button size="sm" onClick={() => void letter.approval.prepareResume()}>
              Повторить
            </Button>
          )}
          {failure.generalResume ? (
            <Button size="sm" onClick={() => void letter.approval.attachGeneralResume()}>
              Приложить общее резюме
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function Approval({ letter, onSend }: ApprovalProps) {
  const { approval, draft } = letter;
  if (approval.saved) {
    return (
      <>
        <ResultLine text="Письмо одобрено" />
        <div className="actions m-commit">
          <Button variant="primary" icon="send" onClick={onSend}>
            К отправке
          </Button>
          <Button icon="edit" onClick={approval.reset}>
            Изменить письмо
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <ResumeGate letter={letter} />
      {approval.error ? <StatusLine state="err" text={approval.error} /> : null}
      <div className="actions m-commit">
        <Button
          variant="primary"
          icon="check"
          busy={approval.busy}
          disabled={!draft.text.trim()}
          onClick={() => void approval.approve()}
        >
          Одобрить
        </Button>
      </div>
    </>
  );
}

export interface LetterStepProps {
  readonly letter: LetterScreenState;
  readonly head: ApplyHead;
  readonly onSend: () => void;
}

/** Шаг «Письмо» (O2): адресат, тон и язык, текст и одобрение. */
export function LetterStep({ letter, head, onSend }: LetterStepProps) {
  const { draft, circles, approval } = letter;
  const options = recipientOptions(circles.data?.circles ?? [], head.source);
  const pending = circles.loading || (draft.loading && !draft.pitch);
  const failed = circles.error || draft.error;
  return (
    <section className="lead" aria-labelledby="lt-title">
      <h2 className="lead-title is-long" id="lt-title">
        {approval.saved ? 'Письмо одобрено' : 'Проверьте письмо'}
      </h2>
      <Recipient letter={letter} options={options} />
      <ToneAndLanguage letter={letter} />
      {pending ? (
        <p className="ls-state" role="status">
          Собираем письмо…
        </p>
      ) : null}
      {!pending && failed ? (
        <StatusLine
          state="err"
          text="Письмо не собралось"
          action={
            <Button size="sm" variant="primary" icon="repeat" onClick={circles.error ? circles.retry : draft.retry}>
              Повторить
            </Button>
          }
        />
      ) : null}
      {!pending && !failed ? (
        <>
          <textarea
            className="letter full ap-letter"
            aria-label="Текст письма"
            value={draft.text}
            readOnly={Boolean(approval.saved)}
            onChange={(event) => draft.setText(event.currentTarget.value)}
          />
          {draft.loading ? (
            <p className="ls-state" role="status">
              Пересобираем письмо…
            </p>
          ) : (
            <Approval letter={letter} onSend={onSend} />
          )}
        </>
      ) : null}
    </section>
  );
}
