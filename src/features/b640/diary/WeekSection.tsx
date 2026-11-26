import type { CareerDiaryEntry } from '../../../../shared/careerDiaryEntries';
import { Icon } from '../kit/Icon';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import type { GoalOption } from './EntryEditor';
import { EntryItem } from './EntryItem';
import { summaryBody, summaryHeadline, weekRange, type WeekGroup } from './model';

export interface WeekSectionProps {
  readonly group: WeekGroup;
  readonly number: number | null;
  readonly current: boolean;
  readonly goals: readonly GoalOption[];
  readonly onSaved: (entry: CareerDiaryEntry) => void;
  readonly onDelete: (entry: CareerDiaryEntry) => Promise<void>;
}

/** Итог недели: свёрнутый подведённый или кнопка «Подвести итог». */
function WeekSummary({
  group,
  current,
  link,
}: {
  readonly group: WeekGroup;
  readonly current: boolean;
  readonly link: string;
}) {
  if (group.summary) {
    return (
      <details className="dn-sum">
        <summary>
          <Icon name="check" />
          {summaryHeadline(group.summary, group.entries)}
        </summary>
        <p className="dn-sum-t">{summaryBody(group.summary, group.entries)}</p>
        <div className="actions">
          <Link className="btn is-sm" to={link}>
            Изменить итог
          </Link>
        </div>
      </details>
    );
  }
  if (!current || group.entries.length === 0) return null;
  return (
    <div className="actions dn-week-act">
      <Link className="btn is-sm" to={link}>
        Подвести итог
      </Link>
    </div>
  );
}

/** Неделя ленты (`section.dn-week`): заголовок, итог и записи. */
export function WeekSection({
  group,
  number,
  current,
  goals,
  onSaved,
  onDelete,
}: WeekSectionProps) {
  const headingId = `dw-${group.weekStart}`;
  const link = `${buildNodePath('d00d')}?week=${group.weekStart}`;
  return (
    <section className="dn-week" aria-labelledby={headingId}>
      <div className="dn-week-top">
        <h3 className="dn-week-h" id={headingId}>
          {number ? `Неделя ${number} ` : 'Неделя '}
          <small>{`· ${weekRange(group.weekStart)}`}</small>
        </h3>
      </div>
      <WeekSummary group={group} current={current} link={link} />
      {group.entries.length > 0 ? (
        <ul className="dn-list">
          {group.entries.map((entry, index) => (
            <EntryItem
              key={entry.id}
              entry={entry}
              goals={goals}
              open={current && index === 0}
              onSaved={onSaved}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
