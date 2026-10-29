import { useEffect, useRef, useState } from 'react';
import { CaretDown, X } from '@phosphor-icons/react';
import { useEscapeLayer } from '../shell/escapeLayers';
import type { SkillConfirmation } from './skillConfirmationApi';
import {
  SKILL_CONFIRM_DISCLAIMER,
  SKILL_CONFIRM_EXPLANATION,
  formatShortDate,
} from './skillConfirmationLabels';
import { SkillQuizFlow } from './SkillQuizFlow';
import './skill-confirm.css';

interface SkillConfirmDialogProps {
  readonly skills: readonly SkillConfirmation[];
  readonly initialSkillName?: string;
  readonly onClose: () => void;
  /** Opens the consultant with a question about the skill. */
  readonly onDiscuss?: (skillName: string) => void;
  /** The server accepted a quiz result: the caller re-reads the profile. */
  readonly onApplied: () => void;
}

function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }, []);
  return ref;
}

function DiscussedNote({ skill }: { readonly skill: SkillConfirmation }) {
  const fact = skill.conversation.facts[0];
  if (skill.conversation.state !== 'discussed' || !fact) return null;
  return (
    <p className="skill-confirm-discussed">
      <b>Разобрано в беседе</b>
      <span>
        {fact.statement}
        {formatShortDate(fact.at) ? ` · ${formatShortDate(fact.at)}` : ''}
      </span>
    </p>
  );
}

function QuizPath({
  skill,
  onApplied,
}: {
  readonly skill: SkillConfirmation;
  readonly onApplied: () => void;
}) {
  const [started, setStarted] = useState(false);
  if (!skill.quizCheckable) {
    return (
      <p className="skill-confirm-note">
        Этот навык тестом не проверить: у него нет вопросов с однозначным ответом. Разберите его в
        беседе с консультантом.
      </p>
    );
  }
  if (skill.attemptsLeftToday <= 0) {
    return <p className="skill-confirm-note">Две попытки за сутки использованы.</p>;
  }
  if (!started) {
    return (
      <button type="button" className="career-primary-button" onClick={() => setStarted(true)}>
        Пройти тест
      </button>
    );
  }
  return <SkillQuizFlow key={skill.name} skillName={skill.name} onApplied={onApplied} />;
}

function SkillConfirmBody(
  props: SkillConfirmDialogProps & {
    readonly skill: SkillConfirmDialogProps['skills'][number];
    readonly onPick: (name: string) => void;
  },
) {
  const { skills, skill, onClose, onDiscuss, onApplied } = props;
  return (
    <>
      <label className="skill-confirm-pick">
        <span>Навык</span>
        <div className="career-responses-select-wrap">
          <select
            className="career-responses-select"
            value={skill.name}
            onChange={(event) => props.onPick(event.target.value)}
          >
            {skills.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          <CaretDown size={14} className="career-responses-select-caret" aria-hidden="true" />
        </div>
      </label>
      <DiscussedNote skill={skill} />
      <div className="skill-confirm-paths">
        <QuizPath key={skill.name} skill={skill} onApplied={onApplied} />
        {onDiscuss ? (
          <button
            type="button"
            className="career-secondary-button"
            onClick={() => {
              onClose();
              onDiscuss(skill.name);
            }}
          >
            Разобрать в беседе
          </button>
        ) : null}
      </div>
    </>
  );
}

export function SkillConfirmDialog(props: SkillConfirmDialogProps) {
  const { skills, onClose } = props;
  useEscapeLayer(onClose);
  const ref = useModalDialog();
  const [name, setName] = useState(
    props.initialSkillName ??
      (skills.find((item) => item.status !== 'подтверждён') ?? skills[0])?.name ??
      '',
  );
  const skill = skills.find((item) => item.name === name) ?? skills[0];
  return (
    <dialog
      ref={ref}
      className="skill-confirm-dialog"
      aria-labelledby="skill-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="skill-confirm-header">
        <h2 id="skill-confirm-title">Подтвердить навык</h2>
        <button
          type="button"
          className="career-quiet-button"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <X size="1em" aria-hidden="true" />
        </button>
      </header>
      <p>{SKILL_CONFIRM_EXPLANATION}</p>
      <p className="skill-confirm-disclaimer">{SKILL_CONFIRM_DISCLAIMER}</p>
      {skill ? (
        <SkillConfirmBody {...props} skill={skill} onPick={setName} />
      ) : (
        <p className="skill-confirm-note">В профиле пока нет навыков для проверки.</p>
      )}
    </dialog>
  );
}
