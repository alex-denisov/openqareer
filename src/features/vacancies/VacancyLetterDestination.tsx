import { useState, type ReactNode } from 'react';
import {
  ArrowSquareOut,
  CaretRight,
  Check,
  Clock,
  FileText,
  Info,
  PaperPlaneTilt,
  UserFocus,
  UsersThree,
} from '@phosphor-icons/react';
import type {
  ConnectionCircleNumber,
  ConnectionCirclePath,
  ConnectionCircleResult,
} from './vacancyLetterApi';
import { letterRecipientTitle } from './letterDeliveryPlace';
import { circleSummary, strengthLabel } from './VacancyLetterCircles';
import { LetterInfoTip } from './VacancyLetterInfoTip';

const CIRCLE_HEADINGS: Readonly<Record<ConnectionCircleNumber, string>> = {
  1: 'Написать знакомому',
  2: 'Попросить представить',
  3: 'Холодный отклик',
};

const DESTINATION_TIPS: Readonly<Record<ConnectionCircleNumber, string>> = {
  1: 'Круг 1: письмо знакомому в компании. Связи берутся из ваших импортированных контактов. Всё уйдёт только после вашего одобрения.',
  2: 'Круг 2: просьба представить вас через общего знакомого. Платформа показывает связи по импортированным данным; согласие знакомого она не предполагает.',
  3: 'Круг 3: отклик без знакомых. Резюме собирается под вакансию, письмо идёт вместе с ним. Всё уйдёт только после вашего одобрения.',
};

const PICKER_LABEL: Readonly<Record<ConnectionCircleNumber, string>> = {
  1: 'Кому написать',
  2: 'Через кого попросить',
  3: 'Кому адресовать',
};

export function circleHeadingText(circle: ConnectionCircleNumber): string {
  return CIRCLE_HEADINGS[circle];
}

export function LetterCardHeading({
  circle,
  approved,
  summary,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly approved: boolean;
  /** Макет 9 при 390: под заголовком круга — то, что на 1440 стоит в карточке круга. */
  readonly summary?: string;
}) {
  return (
    <div className={`career-letter-card-head${approved ? ' is-approved' : ''}`}>
      <h2>{CIRCLE_HEADINGS[circle]}</h2>
      {summary ? <p className="career-letter-card-summary">{summary}</p> : null}
      <span className="career-letter-chip is-dim">
        {approved ? <Check size={14} aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
        {approved ? 'Одобрено, ничего не отправлено' : 'Черновик, ничего не отправлено'}
      </span>
    </div>
  );
}

function DestinationRow({
  icon,
  title,
  note,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly note?: string;
  readonly children?: ReactNode;
}) {
  return (
    <li className="career-letter-dest-row">
      <span className="career-letter-dest-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="career-letter-dest-copy">
        <strong>{title}</strong>
        {note ? <small>{note}</small> : null}
      </span>
      {children ? <span className="career-letter-dest-actions">{children}</span> : null}
    </li>
  );
}

function personChain(path: ConnectionCirclePath): string {
  const people =
    path.path.at(-1)?.id === path.recipient.id ? path.path : [...path.path, path.recipient];
  return people
    .map((person) => person.fullName)
    .filter(Boolean)
    .join(' → ');
}

function pathNote(path: ConnectionCirclePath): string {
  const role = path.recipient.roleTitle ?? 'Роль не указана';
  const company = path.recipient.companyName ? ' · ' + path.recipient.companyName : '';
  return `${role}${company} · ${path.evidence.join(' · ') || strengthLabel(path.strength)}`;
}

function ConnectionPathOption({
  path,
  selected,
  onSelect,
}: {
  readonly path: ConnectionCirclePath;
  readonly selected?: string;
  readonly onSelect: (pathId: string) => void;
}) {
  return (
    <label className="career-letter-path-option">
      <input
        type="radio"
        name="vacancy-letter-connection-path"
        value={path.id}
        checked={selected === path.id}
        onChange={() => onSelect(path.id)}
      />
      <span className="career-letter-path-copy">
        <strong>{path.recipient.fullName}</strong>
        <span>{pathNote(path)}</span>
        {path.circle === 2 && personChain(path) ? <span>Путь: {personChain(path)}</span> : null}
      </span>
    </label>
  );
}

function ConnectionPathPicker({
  circle,
  paths,
  selected,
  disabled,
  onSelect,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly paths: readonly ConnectionCirclePath[];
  readonly selected?: string;
  readonly disabled: boolean;
  readonly onSelect: (pathId: string) => void;
}) {
  return (
    <fieldset className="career-letter-path-picker" disabled={disabled}>
      <legend>{PICKER_LABEL[circle]}</legend>
      {paths.map((path) => (
        <ConnectionPathOption key={path.id} path={path} selected={selected} onSelect={onSelect} />
      ))}
    </fieldset>
  );
}

function CircleEmptyState({
  circle,
  summary,
  frozen,
  onShowPaths,
  onOpenContacts,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly summary: string;
  readonly frozen: boolean;
  readonly onShowPaths: () => void;
  readonly onOpenContacts: () => void;
}) {
  return (
    <div className="career-letter-circle-empty" role="status">
      <Info size={16} aria-hidden="true" />
      <span>{summary}</span>
      {circle === 1 ? (
        <div className="career-letter-empty-actions">
          <button
            type="button"
            className="career-btn career-btn-secondary"
            disabled={frozen}
            onClick={onShowPaths}
          >
            Показать пути
          </button>
          <button
            type="button"
            className="career-btn career-btn-secondary"
            disabled={frozen}
            onClick={onOpenContacts}
          >
            Добавить контакт
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RecipientActions({
  circle,
  canChoose,
  choosing,
  frozen,
  onToggleChoice,
  onOpenContacts,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly canChoose: boolean;
  readonly choosing: boolean;
  readonly frozen: boolean;
  readonly onToggleChoice: () => void;
  readonly onOpenContacts: () => void;
}) {
  return (
    <>
      {canChoose ? (
        <button
          type="button"
          className="career-btn is-sm is-ghost"
          disabled={frozen}
          aria-expanded={choosing}
          aria-label="Изменить получателя"
          onClick={onToggleChoice}
        >
          Изменить
        </button>
      ) : null}
      {circle === 1 ? (
        <button
          type="button"
          className="career-btn is-sm is-ghost"
          disabled={frozen}
          onClick={onOpenContacts}
        >
          Управлять контактами
        </button>
      ) : null}
    </>
  );
}

interface RecipientRowProps {
  readonly circle: ConnectionCircleNumber;
  readonly result?: ConnectionCircleResult;
  readonly path: ConnectionCirclePath;
  readonly vacancyUrl: string;
  readonly frozen: boolean;
  readonly onSelectPath: (pathId: string) => void;
  readonly onOpenContacts: () => void;
}

function RecipientRow({
  circle,
  result,
  path,
  vacancyUrl,
  frozen,
  onSelectPath,
  onOpenContacts,
}: RecipientRowProps) {
  const [choosing, setChoosing] = useState(false);
  const paths = result?.paths ?? [];
  const name =
    circle === 2 ? personChain(path) || path.recipient.fullName : path.recipient.fullName;
  const Icon = circle === 2 ? UsersThree : UserFocus;
  return (
    <>
      <DestinationRow
        icon={<Icon size={18} />}
        title={letterRecipientTitle(circle, path, name, vacancyUrl)}
        note={pathNote(path)}
      >
        <RecipientActions
          circle={circle}
          canChoose={paths.length > 1}
          choosing={choosing}
          frozen={frozen}
          onToggleChoice={() => setChoosing((open) => !open)}
          onOpenContacts={onOpenContacts}
        />
      </DestinationRow>
      {choosing && paths.length > 1 ? (
        <li className="career-letter-dest-picker">
          <ConnectionPathPicker
            circle={circle}
            paths={paths}
            selected={path.id}
            disabled={frozen}
            onSelect={(id) => {
              onSelectPath(id);
              setChoosing(false);
            }}
          />
        </li>
      ) : null}
    </>
  );
}

export interface LetterDestinationProps {
  readonly circle: ConnectionCircleNumber;
  readonly result?: ConnectionCircleResult;
  readonly path?: ConnectionCirclePath;
  readonly vacancyUrl: string;
  readonly frozen: boolean;
  readonly onSelectPath: (pathId: string) => void;
  readonly onShowPaths: () => void;
  readonly onOpenContacts: () => void;
  readonly onOpenResume?: () => void;
  /** Пояснение строки резюме по состоянию черновика и одобрения (B601). */
  readonly resumeNote?: string;
}

function ResumeAndResponseRows({
  onOpenResume,
  resumeNote,
}: {
  readonly onOpenResume?: () => void;
  readonly resumeNote?: string;
}) {
  return (
    <>
      <DestinationRow
        icon={<FileText size={18} />}
        title="Резюме под вакансию"
        note={resumeNote}
      >
        {onOpenResume ? (
          <button
            type="button"
            className="career-btn is-sm is-ghost career-letter-dest-open"
            aria-label="Открыть резюме под вакансию"
            onClick={onOpenResume}
          >
            <ArrowSquareOut className="career-letter-dest-open-icon" aria-hidden="true" />
            <span className="career-letter-dest-open-label">Открыть</span>
            <CaretRight className="career-letter-dest-open-caret" size={14} aria-hidden="true" />
          </button>
        ) : null}
      </DestinationRow>
      <DestinationRow
        icon={<PaperPlaneTilt size={18} />}
        title="Отклик с письмом"
        note="После одобрения заявка с письмом появится в «Откликах». Ничего не отправляется автоматически."
      />
    </>
  );
}

export function LetterDestination(props: LetterDestinationProps) {
  const { circle, result, path, frozen, onShowPaths, onOpenContacts, onOpenResume } = props;
  const isEmpty = result?.state !== 'available' || result.paths.length === 0 || !path;
  const summary = path?.evidence[0] || circleSummary(result);
  return (
    <div className="career-letter-block" aria-label="Куда и что отправим" role="group">
      <div className="career-letter-sub-head">
        <h3>Куда и что отправим</h3>
        <LetterInfoTip text={DESTINATION_TIPS[circle]} />
      </div>
      {isEmpty ? (
        <CircleEmptyState
          circle={circle}
          summary={summary}
          frozen={frozen}
          onShowPaths={onShowPaths}
          onOpenContacts={onOpenContacts}
        />
      ) : null}
      <ul className="career-letter-dest-list">
        {!isEmpty && path ? (
          <RecipientRow
            circle={circle}
            result={result}
            path={path}
            vacancyUrl={props.vacancyUrl}
            frozen={frozen}
            onSelectPath={props.onSelectPath}
            onOpenContacts={onOpenContacts}
          />
        ) : null}
        <ResumeAndResponseRows onOpenResume={onOpenResume} resumeNote={props.resumeNote} />
      </ul>
      {/* Макет 9 при 390: без (i), пояснение — подпись под списком. */}
      <p className="career-letter-foot career-letter-dest-foot">
        {DESTINATION_TIPS[circle]} Шанс ответа не показываем: откликов пока мало.
      </p>
    </div>
  );
}
