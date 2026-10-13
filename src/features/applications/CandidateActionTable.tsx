import { useEffect, useState } from 'react';
import { CheckCircle, PencilSimple, WarningCircle } from '@phosphor-icons/react';
import type { SelectableActionApplication } from './candidateActionModel';

export interface CandidateActionTableProps {
  readonly items: readonly SelectableActionApplication[];
  readonly selectedIds: ReadonlySet<string>;
  readonly letters: ReadonlyMap<string, string>;
  readonly disabled: boolean;
  readonly onToggle: (id: string, selected: boolean) => void;
  readonly onToggleAll: (selected: boolean) => void;
  readonly onLetter: (id: string, value: string) => void;
}

const CHANNEL_LABEL = {
  hh: 'Отклик на hh.ru',
  linkedin: 'Easy Apply в LinkedIn',
} as const;

export function CandidateActionTable(props: CandidateActionTableProps) {
  const allSelected =
    props.items.length > 0 &&
    props.items.every((item) => props.selectedIds.has(item.application.id));
  return (
    <div className="career-candidate-actions__table-wrap">
      <table className="career-candidate-actions__table" aria-label="Вакансии на этапе «Хочу»">
        <thead>
          <tr>
            <th scope="col" className="career-candidate-actions__check-col">
              <input
                type="checkbox"
                aria-label="Выбрать все"
                checked={allSelected}
                disabled={props.disabled}
                onChange={(event) => props.onToggleAll(event.currentTarget.checked)}
              />
            </th>
            <th scope="col">Вакансия и компания</th>
            <th scope="col">Канал</th>
            <th scope="col">Письмо</th>
            <th scope="col">
              <span className="career-sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <CandidateActionRow
              key={item.application.id}
              item={item}
              selected={props.selectedIds.has(item.application.id)}
              letter={props.letters.get(item.application.id) ?? ''}
              disabled={props.disabled}
              onToggle={(selected) => props.onToggle(item.application.id, selected)}
              onLetter={(value) => props.onLetter(item.application.id, value)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandidateActionRow({
  item,
  selected,
  letter,
  disabled,
  onToggle,
  onLetter,
}: {
  readonly item: SelectableActionApplication;
  readonly selected: boolean;
  readonly letter: string;
  readonly disabled: boolean;
  readonly onToggle: (selected: boolean) => void;
  readonly onLetter: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (selected) setEditing(true);
  }, [selected]);
  const { application } = item;
  const label = rowLabel(item);
  const textareaId = `candidate-action-letter-${application.id}`;
  return (
    <>
      <tr className={selected ? 'is-selected' : undefined}>
        <td className="career-candidate-actions__check-col">
          <input
            type="checkbox"
            aria-label={`Выбрать ${label}`}
            checked={selected}
            disabled={disabled}
            onChange={(event) => onToggle(event.currentTarget.checked)}
          />
        </td>
        <RowDetails item={item} label={label} letter={letter} />
        <RowAction
          expanded={editing}
          controls={textareaId}
          onToggle={() => setEditing((value) => !value)}
        />
      </tr>
      {editing ? <LetterEditor id={textareaId} letter={letter} onLetter={onLetter} /> : null}
    </>
  );
}

function RowDetails({
  item,
  label,
  letter,
}: {
  readonly item: SelectableActionApplication;
  readonly label: string;
  readonly letter: string;
}) {
  return (
    <>
      <th scope="row">
        <strong>{label}</strong>
        <span className="career-candidate-actions__url">{item.targetUrl}</span>
      </th>
      <td>{CHANNEL_LABEL[item.platform]}</td>
      <td>
        <LetterState platform={item.platform} letter={letter} />
      </td>
    </>
  );
}

function RowAction({
  expanded,
  controls,
  onToggle,
}: {
  readonly expanded: boolean;
  readonly controls: string;
  readonly onToggle: () => void;
}) {
  return (
    <td className="career-candidate-actions__row-action">
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={onToggle}
      >
        <PencilSimple aria-hidden="true" />
        Править письмо
      </button>
    </td>
  );
}

function LetterEditor({
  id,
  letter,
  onLetter,
}: {
  readonly id: string;
  readonly letter: string;
  readonly onLetter: (value: string) => void;
}) {
  return (
    <tr className="career-candidate-actions__editor-row">
      <td />
      <td colSpan={4}>
        <label className="career-candidate-actions__letter" htmlFor={id}>
          Текст письма или заметки для площадки
          <textarea
            id={id}
            value={letter}
            onChange={(event) => onLetter(event.currentTarget.value)}
            maxLength={5_000}
          />
        </label>
      </td>
    </tr>
  );
}

function LetterState({
  platform,
  letter,
}: {
  readonly platform: 'hh' | 'linkedin';
  readonly letter: string;
}) {
  if (platform === 'linkedin') return <span className="career-pill is-muted">Письмо не нужно</span>;
  return letter.trim() ? (
    <span className="career-pill is-good">
      <CheckCircle aria-hidden="true" />
      Письмо готово
    </span>
  ) : (
    <span className="career-pill is-warn">
      <WarningCircle aria-hidden="true" />
      Нужно письмо
    </span>
  );
}

function rowLabel(item: SelectableActionApplication): string {
  const { vacancy } = item.application;
  const title = vacancy?.title ?? 'Вакансия без названия';
  const company = vacancy?.companyHidden
    ? 'Компания скрыта'
    : vacancy?.company || 'Компания не указана';
  return `${title} · ${company}`;
}
