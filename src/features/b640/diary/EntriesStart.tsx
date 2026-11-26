import type { CareerDiaryWorkplace } from '../../../../shared/careerDiary';
import { Icon } from '../kit/Icon';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import type { DiaryContext } from './useDiaryContext';

const DAY_MS = 86_400_000;

/** `?write=1`: «Первая запись» открывает ленту с быстрой записью и курсором в ней. */
export const WRITE_PARAM = 'write';

/** «День N» на новом месте, считая день выхода первым; до выхода — `null`. */
export function workDay(startDate: string, day: string): number | null {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const now = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(now) || now < start) return null;
  return Math.floor((now - start) / DAY_MS) + 1;
}

function workplaceLine(workplace: CareerDiaryWorkplace, day: string): string {
  const number = workDay(workplace.startDate, day);
  return [workplace.company, workplace.title, ...(number ? [`день ${number}`] : [])].join(' · ');
}

/** d00a: дневник пуст — с чего начать. */
export function DiaryStart({
  workplace,
  day,
}: {
  readonly workplace: CareerDiaryWorkplace | null;
  readonly day: string;
}) {
  const firstDay = workplace !== null && workDay(workplace.startDate, day) === 1;
  return (
    <section className="lead" aria-labelledby="dn-a">
      <h2 className="lead-title is-long" id="dn-a">
        {firstDay ? 'Первый рабочий день. С чего начнём дневник?' : 'С чего начнём дневник?'}
      </h2>
      {workplace ? <p className="lead-sub">{workplaceLine(workplace, day)}</p> : null}
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('d01')}>
          <Icon name="path" />
          Начать с плана адаптации
        </Link>
        <Link className="btn" to={`${buildNodePath('d00')}?${WRITE_PARAM}=1`}>
          <Icon name="note" />
          Первая запись
        </Link>
      </div>
    </section>
  );
}

function SideModule(props: {
  readonly id: string;
  readonly title: string;
  readonly text?: string;
  readonly action: string;
  readonly to: string;
}) {
  return (
    <section className="dn-side only-desk" aria-labelledby={props.id}>
      <h3 className="dn-side-h" id={props.id}>
        {props.title}
      </h3>
      {props.text ? <p className="dn-side-t">{props.text}</p> : null}
      <Link className="btn is-sm" to={props.to}>
        {props.action}
      </Link>
    </section>
  );
}

/** d00b: справа — план адаптации и цели, пока их нет. */
export function DiarySideStart({
  context,
  day,
}: {
  readonly context: DiaryContext;
  readonly day: string;
}) {
  const { workplace } = context;
  return (
    <>
      {workplace ? (
        <SideModule
          id="dn-plan"
          title="Адаптация"
          text={workplaceLine(workplace, day)}
          action="Открыть план"
          to={buildNodePath('d01')}
        />
      ) : context.workplaceKnown ? (
        <SideModule
          id="dn-plan"
          title="План адаптации"
          action="Добавить план"
          to={buildNodePath('d01')}
        />
      ) : null}
      {context.goalsKnown && context.goals.length === 0 ? (
        <SideModule id="dn-goals" title="Цели" action="Задать цель" to={buildNodePath('d02b')} />
      ) : null}
    </>
  );
}
