import { useRef, type KeyboardEvent } from 'react';
import { EnvelopeSimple, UserFocus, UsersThree } from '@phosphor-icons/react';
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

export function circleSummary(result?: ConnectionCircleResult): string {
  const firstPath = result?.paths[0];
  return (
    result?.message ||
    firstPath?.evidence[0] ||
    (firstPath ? strengthLabel(firstPath.strength) : fallbackCircleMessage(result?.state))
  );
}

function fallbackCircleMessage(state?: ConnectionCircleResult['state']): string {
  if (state === 'unknown') return 'Связи не подтверждены; путь неизвестен.';
  if (state === 'none') return 'В доступных кандидатских связях знакомых не найдено.';
  return 'Выберите путь, по которому хотите подготовить письмо.';
}

export function strengthLabel(strength: ConnectionCirclePath['strength']): string {
  if (strength === 'weak') return 'Слабая связь';
  if (strength === 'direct') return 'Прямой контакт';
  if (strength === 'strong') return 'Сильная связь';
  return 'Сила связи неизвестна';
}
