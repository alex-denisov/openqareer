import { useRef, type KeyboardEvent } from 'react';
import { EnvelopeSimple, Info, UserFocus, UsersThree } from '@phosphor-icons/react';
import type {
  ConnectionCircleNumber,
  ConnectionCirclePath,
  ConnectionCircleResult,
} from './vacancyLetterApi';

const CIRCLE_OPTIONS: readonly {
  readonly id: ConnectionCircleNumber;
  readonly label: string;
  readonly title: string;
  readonly Icon: typeof UserFocus;
}[] = [
  { id: 1, label: 'Круг 1', title: 'Знакомый в компании', Icon: UserFocus },
  { id: 2, label: 'Круг 2', title: 'Через знакомого', Icon: UsersThree },
  { id: 3, label: 'Круг 3', title: 'Холодный отклик', Icon: EnvelopeSimple },
];

export function CircleTabs({
  selected,
  circles,
  frozen,
  onSelect,
}: {
  readonly selected: ConnectionCircleNumber;
  readonly circles: readonly ConnectionCircleResult[];
  readonly frozen: boolean;
  readonly onSelect: (circle: ConnectionCircleNumber) => void;
}) {
  const tabRefs = useRef(new Map<ConnectionCircleNumber, HTMLButtonElement>());
  return (
    <div className="career-letter-circles" role="tablist" aria-label="Круг связей">
      {CIRCLE_OPTIONS.map((option, index) => {
        const result = circles.find((circle) => circle.circle === option.id);
        const Icon = option.Icon;
        return (
          <button
            key={option.id}
            ref={(element) => setCircleTabRef(tabRefs.current, option.id, element)}
            type="button"
            role="tab"
            id={`career-letter-tab-${option.id}`}
            aria-label={`${option.label}: ${option.title}`}
            aria-controls="career-letter-active-circle"
            aria-selected={selected === option.id}
            tabIndex={selected === option.id ? 0 : -1}
            className="career-letter-circle-tab"
            disabled={frozen}
            onClick={() => onSelect(option.id)}
            onKeyDown={(event) => activateAdjacentCircle(event, index, tabRefs.current, onSelect)}
          >
            <span className="career-letter-circle-tab-label">
              <Icon size={16} aria-hidden="true" />
              {option.label}
            </span>
            <strong>{option.title}</strong>
            <span className="career-letter-circle-tab-summary">{circleSummary(result)}</span>
          </button>
        );
      })}
    </div>
  );
}

function setCircleTabRef(
  refs: Map<ConnectionCircleNumber, HTMLButtonElement>,
  circle: ConnectionCircleNumber,
  element: HTMLButtonElement | null,
) {
  if (element) refs.set(circle, element);
  else refs.delete(circle);
}

function activateAdjacentCircle(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  refs: Map<ConnectionCircleNumber, HTMLButtonElement>,
  onSelect: (circle: ConnectionCircleNumber) => void,
) {
  const nextIndex = circleTabIndexForKey(index, event.key);
  if (nextIndex === null) return;
  event.preventDefault();
  const nextCircle = CIRCLE_OPTIONS[nextIndex]!.id;
  onSelect(nextCircle);
  refs.get(nextCircle)?.focus();
}

function circleTabIndexForKey(index: number, key: string): number | null {
  if (key === 'ArrowRight') return (index + 1) % CIRCLE_OPTIONS.length;
  if (key === 'ArrowLeft') return (index - 1 + CIRCLE_OPTIONS.length) % CIRCLE_OPTIONS.length;
  if (key === 'Home') return 0;
  if (key === 'End') return CIRCLE_OPTIONS.length - 1;
  return null;
}

function circleSummary(result?: ConnectionCircleResult): string {
  const firstPath = result?.paths[0];
  return (
    result?.message ||
    firstPath?.evidence[0] ||
    (firstPath ? strengthLabel(firstPath.strength) : fallbackCircleMessage(result?.state))
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
      <div className="career-letter-empty-actions">
        {circle === 1 ? (
          <button
            type="button"
            className="career-btn career-btn-secondary"
            disabled={frozen}
            onClick={onShowPaths}
          >
            Показать пути
          </button>
        ) : null}
        {circle === 1 ? (
          <button
            type="button"
            className="career-btn career-btn-secondary"
            disabled={frozen}
            onClick={onOpenContacts}
          >
            Добавить контакт
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function LetterCircleHeading({
  circle,
  result,
  path,
  frozen,
  onSelectPath,
  onShowPaths,
  onOpenContacts,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly result?: ConnectionCircleResult;
  readonly path?: ConnectionCirclePath;
  readonly frozen: boolean;
  readonly onSelectPath: (pathId: string) => void;
  readonly onShowPaths: () => void;
  readonly onOpenContacts: () => void;
}) {
  const title =
    circle === 1
      ? 'Написать знакомому'
      : circle === 2
        ? 'Попросить представить'
        : 'Холодный отклик';
  const summary = path?.evidence[0] || circleSummary(result);
  const isEmpty = result?.state !== 'available' || result.paths.length === 0;
  return (
    <section
      className="career-letter-circle-section"
      id="career-letter-active-circle"
      role="tabpanel"
      aria-labelledby={`career-letter-tab-${circle}`}
      tabIndex={0}
      aria-label={title}
    >
      <CircleSectionHeader title={title} summary={summary} />
      <CircleSelectionContent
        circle={circle}
        result={result}
        path={path}
        frozen={frozen}
        isEmpty={isEmpty}
        summary={summary}
        onSelectPath={onSelectPath}
        onShowPaths={onShowPaths}
        onOpenContacts={onOpenContacts}
      />
    </section>
  );
}

function CircleSectionHeader({
  title,
  summary,
}: {
  readonly title: string;
  readonly summary: string;
}) {
  return (
    <div className="career-letter-circle-heading">
      <h2>{title}</h2>
      <p>{summary}</p>
    </div>
  );
}

function CircleSelectionContent({
  circle,
  result,
  path,
  frozen,
  isEmpty,
  summary,
  onSelectPath,
  onShowPaths,
  onOpenContacts,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly result?: ConnectionCircleResult;
  readonly path?: ConnectionCirclePath;
  readonly frozen: boolean;
  readonly isEmpty: boolean;
  readonly summary: string;
  readonly onSelectPath: (pathId: string) => void;
  readonly onShowPaths: () => void;
  readonly onOpenContacts: () => void;
}) {
  return (
    <>
      <CirclePathState
        circle={circle}
        result={result}
        path={path}
        frozen={frozen}
        isEmpty={isEmpty}
        summary={summary}
        onSelectPath={onSelectPath}
        onShowPaths={onShowPaths}
        onOpenContacts={onOpenContacts}
      />
      <CircleAuxiliaryActions
        circle={circle}
        isEmpty={isEmpty}
        frozen={frozen}
        onOpenContacts={onOpenContacts}
      />
    </>
  );
}

function CirclePathState({
  circle,
  result,
  path,
  frozen,
  isEmpty,
  summary,
  onSelectPath,
  onShowPaths,
  onOpenContacts,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly result?: ConnectionCircleResult;
  readonly path?: ConnectionCirclePath;
  readonly frozen: boolean;
  readonly isEmpty: boolean;
  readonly summary: string;
  readonly onSelectPath: (pathId: string) => void;
  readonly onShowPaths: () => void;
  readonly onOpenContacts: () => void;
}) {
  if (isEmpty)
    return (
      <CircleEmptyState
        circle={circle}
        summary={summary}
        frozen={frozen}
        onShowPaths={onShowPaths}
        onOpenContacts={onOpenContacts}
      />
    );
  return (
    <ConnectionPathPicker
      circle={circle}
      paths={result?.paths ?? []}
      selected={path?.id}
      disabled={frozen}
      onSelect={onSelectPath}
    />
  );
}

function CircleAuxiliaryActions({
  circle,
  isEmpty,
  frozen,
  onOpenContacts,
}: {
  readonly circle: ConnectionCircleNumber;
  readonly isEmpty: boolean;
  readonly frozen: boolean;
  readonly onOpenContacts: () => void;
}) {
  return (
    <>
      {circle === 1 && !isEmpty ? (
        <button
          type="button"
          className="career-btn career-btn-secondary"
          disabled={frozen}
          onClick={onOpenContacts}
        >
          Управлять контактами
        </button>
      ) : null}
      {circle === 3 ? <ColdOutreachSummary /> : null}
    </>
  );
}

function fallbackCircleMessage(state?: ConnectionCircleResult['state']): string {
  if (state === 'unknown') return 'Связи не подтверждены; путь неизвестен.';
  if (state === 'none') return 'В доступных кандидатских связях знакомых не найдено.';
  return 'Выберите путь, по которому хотите подготовить письмо.';
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
  const label =
    circle === 2 ? 'Через кого попросить' : circle === 3 ? 'Кому адресовать' : 'Кому написать';
  return (
    <fieldset className="career-letter-path-picker" disabled={disabled}>
      <legend>{label}</legend>
      {paths.map((path) => (
        <ConnectionPathOption
          key={path.id}
          path={path}
          circle={circle}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </fieldset>
  );
}

function ConnectionPathOption({
  path,
  circle,
  selected,
  onSelect,
}: {
  readonly path: ConnectionCirclePath;
  readonly circle: ConnectionCircleNumber;
  readonly selected?: string;
  readonly onSelect: (pathId: string) => void;
}) {
  const people =
    path.path.at(-1)?.id === path.recipient.id ? path.path : [...path.path, path.recipient];
  const chain = people
    .map((person) => person.fullName)
    .filter(Boolean)
    .join(' → ');
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
        <span>
          {path.recipient.roleTitle ?? 'Роль не указана'}
          {path.recipient.companyName ? ' · ' + path.recipient.companyName : ''}
        </span>
        {circle === 2 && chain ? <span>Путь: {chain}</span> : null}
        <span>{path.evidence.join(' · ') || strengthLabel(path.strength)}</span>
      </span>
    </label>
  );
}

function strengthLabel(strength: ConnectionCirclePath['strength']): string {
  if (strength === 'weak') return 'Слабая связь';
  if (strength === 'direct') return 'Прямой контакт';
  if (strength === 'strong') return 'Сильная связь';
  return 'Сила связи неизвестна';
}

function ColdOutreachSummary() {
  return (
    <div className="career-letter-delivery-summary" aria-label="Куда и что отправим">
      <h3>Куда и что отправим</h3>
      <div className="career-letter-delivery-item">
        <strong>Резюме под вакансию</strong>
        <span>Резюме не прикреплено к этому черновику. Факты письма не заменяют резюме.</span>
      </div>
      <div className="career-letter-delivery-item">
        <strong>Отклик с письмом</strong>
        <span>
          После одобрения заявка с письмом появится в «Откликах». Ничего не отправляется
          автоматически.
        </span>
      </div>
    </div>
  );
}
